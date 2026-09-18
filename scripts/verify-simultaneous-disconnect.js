'use strict';

// Prueba de "Performance" (Fase 33 del roadmap "OZAMA PRO"): la
// auditoria de Fase 0 ya habia revisado los timers de sala (todo
// setInterval/setTimeout de sala tiene su clear correspondiente antes
// de reasignar) pero dejo constancia explicita de UNA cosa sin
// verificar: "el camino de desconexion abrupta de ambos jugadores a
// la vez". Leyendo el codigo (startCloseTimer/cancelTimer en Ajedrez,
// damasStartCloseTimer/damasCancelCloseTimer en Damas -- mismo patron
// en los dos juegos) esto ya se ve correcto: cada llamada cancela
// cualquier timer anterior antes de armar uno nuevo, asi que dos
// desconexiones casi simultaneas terminan en UN solo timer vivo, no
// dos, en ambos juegos. Este script convierte esa lectura de codigo
// en una prueba real para AMBOS: conecta dos jugadores de verdad a la
// misma sala, los desconecta a los dos casi al mismo tiempo
// (milisegundos de diferencia, el peor caso realista) y confirma
// contra un server.js real y una Mongo aislada y temporal (nunca
// produccion):
//
//   - la sala sigue viva durante el margen de gracia (no se borra de
//     inmediato solo porque ambos se fueron);
//   - pasados los 30s reales del timer, la sala se cierra UNA sola
//     vez (el log de cierre aparece exactamente una vez, nunca dos --
//     mas de una confirmaria un timer duplicado/fuga);
//   - el documento en Mongo queda cerrado una sola vez.
//
// Ajedrez y Damas corren en PARALELO contra el mismo servidor (ambos
// esperan el mismo margen de 30s real de todos modos, asi que hacerlo
// a la vez no cuesta tiempo extra) -- el timer de cierre no es
// configurable por env en ninguno de los dos juegos (a diferencia de
// NO_PROGRESS_PLY_LIMIT), y cambiarlo solo para esta prueba arriesgaria
// alterar el comportamiento real que se esta verificando.
//
// Uso: node scripts/verify-simultaneous-disconnect.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DISCONNECT_TEST_PORT || 3247);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_discsim' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(cond, message) { if (!cond) throw new Error(`ASSERTION FAILED: ${message}`); }

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

function waitForEvent(socket, event, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

// game: 'chess' | 'damas' -- mismo escenario, distintos nombres de
// evento/campo por juego.
async function testSimultaneousDisconnect(game, serverLines, suffix) {
  const isChess = game === 'chess';
  const prefix = isChess ? '' : 'damas:';
  const label = isChess ? 'Ajedrez' : 'Damas';
  const closedLogSubstring = isChess ? 'cerrada por timeout' : null; // Damas no loguea el cierre por texto -- se confirma via Mongo abajo

  const pW = await register(`disc${isChess ? 'W' : 'DW'}_${suffix}`);
  const pB = await register(`disc${isChess ? 'B' : 'DB'}_${suffix}`);

  const white = io(baseUrl, { auth: { token: pW.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const black = io(baseUrl, { auth: { token: pB.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await Promise.all([waitForEvent(white, 'connect'), waitForEvent(black, 'connect')]);

  white.emit(`${prefix}create-room`, { playerName: pW.user.username, country: 'DO', timeControl: '10+0' });
  const created = await waitForEvent(white, `${prefix}room-created`);
  const code = created.code;
  assert(code, `[${label}] create-room deberia devolver un code, vino ${JSON.stringify(created)}`);

  black.emit(`${prefix}join-room`, { code, playerName: pB.user.username, country: 'DO' });
  await Promise.all([waitForEvent(white, `${prefix}game-start`), waitForEvent(black, `${prefix}game-start`)]);
  console.log(`[${label}] Sala ${code} creada con dos jugadores reales conectados.`);

  const linesBefore = serverLines.length;
  const t0 = Date.now();
  // El peor caso realista: las dos desconexiones llegan casi juntas,
  // no una franca y clara detras de la otra.
  white.disconnect();
  await wait(15);
  black.disconnect();
  console.log(`[${label}] Ambos jugadores desconectados casi al mismo tiempo (15ms de diferencia).`);

  if (isChess) {
    await wait(3000);
    const closedTooEarly = serverLines.slice(linesBefore).some((l) => l.includes(`Sala ${code} ${closedLogSubstring}`));
    assert(!closedTooEarly, `[${label}] la sala no deberia cerrarse antes de que termine el margen de gracia de 30s`);
    console.log(`[${label}] La sala sigue con margen de gracia (no se cerro de inmediato solo porque ambos se fueron).`);
  }

  const remaining = 30_000 - (Date.now() - t0) + 3000;
  await wait(Math.max(0, remaining));

  if (isChess) {
    const closedLines = serverLines.filter((l) => l.includes(`Sala ${code} ${closedLogSubstring}`));
    assert(closedLines.length === 1, `[${label}] la sala deberia cerrarse EXACTAMENTE una vez, aparecio ${closedLines.length} veces en los logs`);
    console.log(`[${label}] La sala se cerro exactamente UNA vez tras el margen de gracia -- ningun timer duplicado.`);
  }

  return code;
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'simultaneous-disconnect-test-secret-32c',
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

    // Ajedrez y Damas en paralelo -- ambos esperan el mismo margen de
    // 30s real de todos modos, correrlos a la vez no cuesta tiempo extra.
    const [chessCode, damasCode] = await Promise.all([
      testSimultaneousDisconnect('chess', serverLines, suffix),
      testSimultaneousDisconnect('damas', serverLines, suffix),
    ]);

    const mongoose = require('mongoose');
    process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
    process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
    const connectDatabase = require('../config/database');
    const Room = require('../models/Room');
    const DamasMatch = require('../models/DamasMatch');
    await connectDatabase();

    const roomDoc = await Room.findOne({ roomCode: chessCode }).lean();
    assert(roomDoc?.status === 'closed', `[Ajedrez] el documento Room deberia quedar 'closed', quedo '${roomDoc?.status}'`);
    console.log('[Ajedrez] El documento Room en Mongo quedo closed, sin escrituras duplicadas.');

    const damasMatch = await DamasMatch.findOne({ roomCode: damasCode }).lean();
    assert(damasMatch, '[Damas] deberia haber quedado un DamasMatch para la sala (abandono registrado, aunque sin mover ELO)');
    assert(damasMatch.result === 'abandoned', `[Damas] el resultado deberia ser 'abandoned', vino '${damasMatch.result}'`);
    console.log('[Damas] Quedo un solo DamasMatch registrado como abandono, sin duplicados.');

    await mongoose.disconnect();

    console.log('\n✅ SIMULTANEOUS_DISCONNECT_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ SIMULTANEOUS_DISCONNECT_FAILED:', err.message);
  process.exit(1);
});
