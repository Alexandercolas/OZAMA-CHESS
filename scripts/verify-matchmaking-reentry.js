'use strict';

// Prueba de "QA -- concurrencia y carga" (Fase 39 del roadmap "OZAMA
// PRO"): auditando quick-match (Juego Rapido) en Ajedrez y Damas se
// encontro un bug real de reentrada. Cada handler hace 2 await
// (getPlayerInfo, la consulta de blockedUsers) ANTES de empujar a la
// cola o de emparejar. El "ya estoy en cola" que hace splice() al
// principio del handler solo mira el estado justo al entrar -- si el
// MISMO socket dispara 'quick-match' dos veces seguidas antes de que
// la primera llamada termine esos await (doble click, o un reintento
// del cliente por lentitud bajo carga -- justo el escenario de esta
// fase: mas trafico concurrente = el event loop tarda mas en volver a
// cada handler = la ventana de reentrada se abre mas seguido), la
// segunda llamada no ve todavia la entrada de la primera y TAMBIEN la
// empuja: el socket queda con DOS entradas en la cola.
//
// Si un rival distinto empareja con esa segunda entrada fantasma
// mientras el jugador ya esta jugando su primera partida,
// createMatchBetween()/createDamasMatchBetween() pisan
// socket.data.roomCode/damasRoomCode SIN fijarse si ya habia uno -- el
// jugador recibe un segundo 'game-start' y queda arrancado de su
// primera partida sin ningun aviso, mientras su primer rival se queda
// jugando contra una sala donde el otro lado ya no esta escuchando.
//
// Este script reproduce el escenario exacto contra un server.js real y
// una Mongo aislada y temporal (nunca produccion): A dispara
// 'quick-match' DOS VECES seguidas (sin esperar la primera), despues
// B empareja (deberia tomar la PRIMERA entrada de A) y por ultimo C
// intenta emparejar (con el guardia puesto, no deberia quedar nadie
// mas esperando para C -- entra a la cola en vez de emparejar con un
// fantasma de A). Exige:
//
//   - A recibe exactamente UN 'game-start' (nunca dos);
//   - la partida de A es contra B, no contra C;
//   - C se queda buscando rival (matchmaking-searching), no jugando.
//
// Uso: node scripts/verify-matchmaking-reentry.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_REENTRY_TEST_PORT || 3249);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_reentry' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(cond, message) { if (!cond) throw new Error(`ASSERTION FAILED: ${message}`); }

async function waitForServer(proc, lines) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}\n${lines.join('\n')}`);
    try {
      const res = await fetch(`${baseUrl}/api/health/db`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {}
    await wait(500);
  }
  throw new Error(`server did not become ready. logs:\n${lines.join('\n')}`);
}

async function register(username) {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO' }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function waitForEvent(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

// Reune TODOS los 'game-start' que le lleguen a un socket durante una
// ventana corta, en vez de resolver con el primero -- exactamente lo
// que hace falta para detectar "recibio dos".
function collectEvents(socket, event, windowMs) {
  const seen = [];
  const handler = (data) => seen.push(data);
  socket.on(event, handler);
  return wait(windowMs).then(() => { socket.off(event, handler); return seen; });
}

async function runFor(game, suffix) {
  const isChess = game === 'chess';
  const prefix = isChess ? '' : 'damas:';
  const tag = isChess ? 'C' : 'D';
  const pA = await register(`reA${tag}_${suffix}`);
  const pB = await register(`reB${tag}_${suffix}`);
  const pC = await register(`reC${tag}_${suffix}`);

  const a = io(baseUrl, { auth: { token: pA.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const b = io(baseUrl, { auth: { token: pB.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const c = io(baseUrl, { auth: { token: pC.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await Promise.all([waitForEvent(a, 'connect'), waitForEvent(b, 'connect'), waitForEvent(c, 'connect')]);

  const label = isChess ? 'Ajedrez' : 'Damas';
  const startsA = collectEvents(a, `${prefix}game-start`, 5000);

  // A dispara quick-match DOS VECES seguidas, sin esperar la primera
  // -- el doble click / reintento bajo carga que dispara la reentrada.
  a.emit(`${prefix}quick-match`, { playerName: pA.user.username, country: 'DO', timeControl: '10+0' });
  a.emit(`${prefix}quick-match`, { playerName: pA.user.username, country: 'DO', timeControl: '10+0' });

  // B entra un instante despues: con o sin el bug, deberia emparejar
  // con la PRIMERA entrada de A.
  await wait(150);
  const bStart = waitForEvent(b, `${prefix}game-start`);
  b.emit(`${prefix}quick-match`, { playerName: pB.user.username, country: 'DO', timeControl: '10+0' });
  await bStart;

  // C llega despues de que A y B ya deberian estar jugando. Si el bug
  // sigue vivo, la segunda entrada fantasma de A todavia esta en la
  // cola y C empareja con ella -- arrancando a A de su partida con B.
  const cOutcome = Promise.race([
    waitForEvent(c, `${prefix}game-start`).then((data) => ({ type: 'matched', data })),
    waitForEvent(c, `${prefix}matchmaking-searching`).then((data) => ({ type: 'searching', data })),
  ]);
  c.emit(`${prefix}quick-match`, { playerName: pC.user.username, country: 'DO', timeControl: '10+0' });
  const cResult = await cOutcome;

  const aStarts = await startsA;

  console.log(`[${label}] A recibio ${aStarts.length} 'game-start'. C quedo: ${cResult.type}.`);

  a.disconnect(); b.disconnect(); c.disconnect();
  c.emit(`${prefix}quick-match-cancel`);

  return { label, aStarts, cResult, aName: pA.user.username, bName: pB.user.username };
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'reentry-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => serverLines.push(...c.toString().split(/\r?\n/)));
  proc.stderr.on('data', (c) => serverLines.push(...c.toString().split(/\r?\n/)));

  try {
    await waitForServer(proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);
    const suffix = String(Date.now()).slice(-8);

    const [chess, damas] = await Promise.all([
      runFor('chess', suffix),
      runFor('damas', suffix),
    ]);

    for (const r of [chess, damas]) {
      assert(r.aStarts.length === 1, `[${r.label}] A deberia recibir exactamente 1 'game-start', recibio ${r.aStarts.length} -- la segunda entrada fantasma lo emparejo dos veces`);
      const opponentName = r.aStarts[0]?.playerInfo?.w?.name === r.aName ? r.aStarts[0]?.playerInfo?.b?.name : r.aStarts[0]?.playerInfo?.w?.name;
      assert(opponentName === r.bName, `[${r.label}] la partida de A deberia ser contra B (${r.bName}), quedo contra "${opponentName}"`);
      assert(r.cResult.type === 'searching', `[${r.label}] C deberia quedar buscando rival (no habia nadie mas en cola), quedo '${r.cResult.type}'`);
    }

    console.log('\n✅ MATCHMAKING_REENTRY_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ MATCHMAKING_REENTRY_FAILED:', err.message);
  process.exit(1);
});
