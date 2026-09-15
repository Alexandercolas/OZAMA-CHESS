'use strict';

// Prueba de "Revancha" (Fase 19 del roadmap "OZAMA PRO") para Ajedrez:
// auditoria encontro que Damas ya tenia cobertura de socket para
// revancha/tablas/rendirse (verify-damas-social-flow.js) pero Ajedrez
// no tenia una prueba equivalente. De paso, verificar esto en vivo
// contra un navegador real durante esta misma fase encontro un bug de
// verdad en el CLIENTE (public/script.js): el estado "ya pedi
// revancha, esperando respuesta" vivia dentro de setupControls()
// mientras que el handler de la respuesta del servidor
// (rematch-declined/rematch-start) vive en setupOnlineSocket() -- dos
// funciones hermanas en el mismo archivo que NO comparten scope entre
// si, asi que la primera vez que el rival rechazaba, el navegador
// tiraba un ReferenceError silencioso y el boton se quedaba trabado
// en "Esperando..." para siempre. El fix movio ese estado compartido
// a nivel de modulo. Ese bug especifico solo se puede atrapar con un
// navegador real (ya se verifico asi, en vivo, con dos sesiones
// reales) -- este script cubre en cambio el CONTRATO del servidor del
// que ese fix depende, contra un server.js real y una Mongo aislada y
// temporal (nunca produccion):
//
//   - pedir revancha avisa al rival (rematch-requested);
//   - rechazarla avisa a quien la pidio (rematch-declined) sin tocar
//     el estado de la sala;
//   - una segunda revancha, esta vez aceptada por los dos, arranca de
//     verdad (rematch-start con tablero limpio, mismo timeControl que
//     la partida original, y un Match nuevo en Mongo).
//
// Uso: node scripts/verify-chess-rematch-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_CHESS_REMATCH_TEST_PORT || 3231);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_chessrm' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function waitForServer(proc, lines) {
  const deadline = Date.now() + 25_000;
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

async function postJson(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function register(username) {
  const res = await postJson('/api/auth/register', {
    username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO',
  });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

function waitEvent(socket, event, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
    function onEvent(payload) { clearTimeout(timer); resolve(payload); }
    socket.once(event, onEvent);
  });
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'chess-rematch-flow-test-secret-at-least-32-c',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));
  proc.stderr.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));

  const sockets = [];
  try {
    await waitForServer(proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const playerA = await register(`crmA_${suffix}`);
    const playerB = await register(`crmB_${suffix}`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    const createdA = waitEvent(sockA, 'room-created');
    sockA.emit('create-room', { playerName: playerA.user.username, country: 'DO', timeControl: '3+0' });
    const roomInfo = await createdA;

    const startA = waitEvent(sockA, 'game-start');
    const startB = waitEvent(sockB, 'game-start');
    sockB.emit('join-room', { code: roomInfo.code, playerName: playerB.user.username, country: 'DO' });
    const [gsA] = await Promise.all([startA, startB]);
    console.log(`Partida creada: sala ${roomInfo.code}, timeControl ${gsA.timeControl}.`);

    // ── A se rinde -- la partida termina ────────────────────────────
    const bSeesResign = waitEvent(sockB, 'opponent-resigned');
    sockA.emit('player-resign', { room: roomInfo.code });
    await bSeesResign;
    console.log('rematch: A se rindio, B (ganador) lo ve via opponent-resigned.');

    // ── B pide revancha -- A la ve ───────────────────────────────────
    const aSeesRequest = waitEvent(sockA, 'rematch-requested');
    sockB.emit('rematch-request', { room: roomInfo.code });
    const reqPayload = await aSeesRequest;
    assert(reqPayload.playerName === playerB.user.username, `rematch-requested deberia traer el nombre de quien pidio, vino ${JSON.stringify(reqPayload)}`);
    console.log('rematch: B pide revancha, A recibe rematch-requested con el nombre correcto.');

    // ── A la rechaza -- B (quien pidio) se entera ───────────────────
    const bSeesDecline = waitEvent(sockB, 'rematch-declined');
    sockA.emit('rematch-decline', { room: roomInfo.code });
    await bSeesDecline;
    console.log('rematch: A la rechaza, B (quien la pidio) recibe rematch-declined.');

    // ── Segunda vuelta: B pide de nuevo, esta vez los DOS aceptan ───
    const aSeesRequest2 = waitEvent(sockA, 'rematch-requested');
    sockB.emit('rematch-request', { room: roomInfo.code });
    await aSeesRequest2;

    const startAgainA = waitEvent(sockA, 'rematch-start');
    const startAgainB = waitEvent(sockB, 'rematch-start');
    sockA.emit('rematch-accept', { room: roomInfo.code });
    sockB.emit('rematch-accept', { room: roomInfo.code });
    const [rsA, rsB] = await Promise.all([startAgainA, startAgainB]);

    assert(rsA.timeControl === '3+0' && rsB.timeControl === '3+0', `la revancha deberia mantener el mismo timeControl "3+0", vino A=${rsA.timeControl} B=${rsB.timeControl}`);
    assert(rsA.clockW === 3 * 60000, `el reloj de la revancha deberia reiniciarse a los 3 minutos completos, vino ${rsA.clockW}`);
    console.log(`rematch: la segunda revancha (aceptada por los dos) arranca de verdad -- mismo timeControl (3+0), reloj reiniciado a ${rsA.clockW}ms.`);

    // ── Confirmar que se creo un Match nuevo (no se reusa el viejo) ──
    process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
    process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
    const mongoose = require('mongoose');
    const connectDatabase = require('../config/database');
    const Match = require('../models/Match');
    await connectDatabase();
    const matches = await Match.find({ roomCode: roomInfo.code }).sort({ createdAt: 1 }).lean();
    assert(matches.length === 2, `deberian existir 2 partidas registradas para la sala (la original + la revancha), vino ${matches.length}`);
    assert(['white_win', 'black_win'].includes(matches[0].result), `la primera (terminada por rendicion de A) deberia tener un resultado real (B gano), vino ${matches[0].result}`);
    assert(matches[1].result === 'in_progress', `la revancha recien arrancada deberia estar result:'in_progress', vino ${matches[1].result}`);
    console.log('rematch: se crea un Match NUEVO para la revancha (no se reusa el registro de la partida anterior).');
    await mongoose.disconnect();

    console.log('\n✅ CHESS_REMATCH_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ CHESS_REMATCH_FLOW_FAILED:', err.message);
  process.exit(1);
});
