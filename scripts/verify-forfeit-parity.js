'use strict';

// Prueba de paridad Ajedrez/Damas (Fase 37 del roadmap "OZAMA PRO",
// bloque de QA): al comparar como cada juego trata a un jugador que se
// desconecta y no vuelve en los 30s de margen, se encontro una
// asimetria real con consecuencias de juego justo:
//
//   - Ajedrez (startCloseTimer): si UNO solo se fue y el otro sigue en
//     la sala, el que se quedo GANA por abandono -- result white_win/
//     black_win, ELO y estadisticas aplicados, el que se fue PIERDE.
//   - Damas (finishDamasGame): cualquier 'opponent-left' se guardaba
//     como result:'abandoned' SIN tocar ELO ni estadisticas. La UI le
//     decia al que se quedo "GANASTE", pero nada se registraba: quien
//     iba perdiendo podia cerrar la pestaña sin penalizacion alguna --
//     peor para el rival que rendirse (que si contaba como derrota).
//
// Este script prueba el mismo escenario en AMBOS juegos a la vez (mismo
// margen de 30s real) contra un server.js real y una Mongo aislada y
// temporal (nunca produccion), y exige que se comporten igual:
//
//   - la partida queda con resultado decisivo a favor de quien se quedo
//     (no 'abandoned');
//   - el ELO del ganador sube y el del que se fue baja;
//   - la victoria/derrota queda en las estadisticas de cada uno.
//
// (El caso "los dos se fueron" -- sin ganador, queda 'abandoned' en
// ambos -- ya lo cubre scripts/verify-simultaneous-disconnect.js.)
//
// Uso: node scripts/verify-forfeit-parity.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_FORFEIT_TEST_PORT || 3248);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_forfeit' });

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

// El de blancas se queda; el de negras se desconecta.
async function playAndForfeit(game, suffix) {
  const isChess = game === 'chess';
  const prefix = isChess ? '' : 'damas:';
  const tag = isChess ? 'C' : 'D';
  const pW = await register(`fp${tag}W_${suffix}`);
  const pB = await register(`fp${tag}B_${suffix}`);

  const white = io(baseUrl, { auth: { token: pW.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const black = io(baseUrl, { auth: { token: pB.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await Promise.all([waitForEvent(white, 'connect'), waitForEvent(black, 'connect')]);

  white.emit(`${prefix}create-room`, { playerName: pW.user.username, country: 'DO', timeControl: '10+0' });
  const created = await waitForEvent(white, `${prefix}room-created`);
  const code = created.code;
  black.emit(`${prefix}join-room`, { code, playerName: pB.user.username, country: 'DO' });
  await Promise.all([waitForEvent(white, `${prefix}game-start`), waitForEvent(black, `${prefix}game-start`)]);

  const label = isChess ? 'Ajedrez' : 'Damas';
  console.log(`[${label}] Sala ${code}: blancas (${pW.user.username}) se queda, negras (${pB.user.username}) se desconecta.`);
  const t0 = Date.now();
  black.disconnect();

  // El que se queda ve el aviso de desconexion del rival.
  await waitForEvent(white, `${prefix}opponent-disconnected`);
  await wait(Math.max(0, 30_000 - (Date.now() - t0) + 4000));
  white.disconnect();
  return { code, whiteId: pW.user.id, blackId: pB.user.id, label, isChess };
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'forfeit-parity-test-secret-at-least-32c',
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
      playAndForfeit('chess', suffix),
      playAndForfeit('damas', suffix),
    ]);

    const mongoose = require('mongoose');
    process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
    process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
    const connectDatabase = require('../config/database');
    const User = require('../models/User');
    const Match = require('../models/Match');
    const DamasMatch = require('../models/DamasMatch');
    await connectDatabase();

    // ═══════ Ajedrez ═══════
    const chessMatch = await Match.findOne({ roomCode: chess.code }).lean();
    assert(chessMatch?.result === 'white_win', `[Ajedrez] deberia ganar blancas por abandono, quedo '${chessMatch?.result}'`);
    const cw = await User.findById(chess.whiteId).select('elo stats').lean();
    const cb = await User.findById(chess.blackId).select('elo stats').lean();
    assert(cw.elo > 1200 && cb.elo < 1200, `[Ajedrez] el ELO del que se quedo deberia subir y el del que se fue bajar, quedaron ${cw.elo} / ${cb.elo}`);
    assert(cw.stats.wins === 1 && cb.stats.losses === 1, `[Ajedrez] estadisticas: ganador wins=1 / perdedor losses=1, quedaron ${cw.stats.wins} / ${cb.stats.losses}`);
    console.log(`[Ajedrez] Gana el que se quedo (ELO ${cw.elo}), pierde el que se fue (ELO ${cb.elo}), estadisticas registradas.`);

    // ═══════ Damas ═══════
    const damasMatch = await DamasMatch.findOne({ roomCode: damas.code }).lean();
    assert(damasMatch?.result === 'white_win', `[Damas] deberia ganar blancas por abandono (igual que Ajedrez), quedo '${damasMatch?.result}'`);
    assert(damasMatch.reason === 'opponent-left', `[Damas] la razon deberia seguir siendo 'opponent-left' para el historial, quedo '${damasMatch.reason}'`);
    const dw = await User.findById(damas.whiteId).select('damasElo damasStats').lean();
    const db = await User.findById(damas.blackId).select('damasElo damasStats').lean();
    assert(dw.damasElo > 1200 && db.damasElo < 1200, `[Damas] el ELO del que se quedo deberia subir y el del que se fue bajar, quedaron ${dw.damasElo} / ${db.damasElo}`);
    assert(dw.damasStats.wins === 1 && db.damasStats.losses === 1, `[Damas] estadisticas: ganador wins=1 / perdedor losses=1, quedaron ${dw.damasStats.wins} / ${db.damasStats.losses}`);
    console.log(`[Damas] Gana el que se quedo (ELO ${dw.damasElo}), pierde el que se fue (ELO ${db.damasElo}), estadisticas registradas -- igual que Ajedrez.`);

    await mongoose.disconnect();
    console.log('\n✅ FORFEIT_PARITY_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ FORFEIT_PARITY_FAILED:', err.message);
  process.exit(1);
});
