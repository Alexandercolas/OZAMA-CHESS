'use strict';

// Prueba de punta a punta de "tablas por falta de progreso" en Damas
// (Fase 15 del roadmap "OZAMA PRO"): auditoria previa encontro que
// Ajedrez ya tiene una version real de la regla de 50 movimientos
// (game.halfMoveClock >= 100, reason:'fifty_move' en server.js) pero
// Damas no tenia NINGUN equivalente -- dos reyes podian, en teoria,
// mover de un lado a otro para siempre sin que ninguno ofreciera
// tablas. Se agrego NO_PROGRESS_PLY_LIMIT (40 jugadas sin captura ni
// coronacion, configurable via env SOLO para pruebas) siguiendo
// exactamente el mismo patron: un contador que se reinicia con
// progreso real y corta la partida al llegar al limite.
//
// Jugar 40 jugadas reales sin que ninguna captura se vuelva obligatoria
// es dificil de armar a mano desde el tablero inicial (los ejercitos
// chocan rapido) -- este script en cambio BUSCA con el motor real una
// linea de N jugadas sin captura (backtracking sobre
// getLegalMovesForSquare, que ya respeta captura obligatoria + regla
// de mayoria), y despues reproduce EXACTAMENTE esas jugadas via
// sockets reales contra un server.js real con el limite bajado a N
// (OZAMA_NO_PROGRESS_PLY_LIMIT=N) -- una partida corta de verdad, no
// una simulacion aparte del codigo del servidor.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion):
//
//   - tras exactamente N jugadas sin captura, el servidor termina la
//     partida solo (sin que nadie ofrezca tablas) con
//     reason:'no-progress', winner:null;
//   - el resultado se guarda como 'draw' en DamasMatch con ese motivo;
//   - el ELO de ambos jugadores se actualiza como una tabla real (ni
//     sube ni baja para dos jugadores del mismo ELO inicial).
//
// Uso: node scripts/verify-damas-no-progress-draw.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const PLY_LIMIT = 6;
const port = Number(process.env.OZAMA_DAMAS_NOPROGRESS_TEST_PORT || 3227);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_dnoprog' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

function hasCapture(seq) { return seq.some((s) => s.capturedR !== -1); }

// Backtracking sobre el motor REAL (public/checkers-engine.js, el
// mismo que corre server.js) para encontrar una linea de `depth`
// jugadas legales consecutivas sin ninguna captura. Si en algun punto
// la captura es obligatoria para el color en turno, esa rama se
// descarta (return null) y se prueba otro candidato anterior.
function findNonCaptureLine(OzamaCheckers, board, color, depth, moves) {
  if (depth === 0) return moves;
  const candidates = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      for (const seq of OzamaCheckers.getLegalMovesForSquare(board, r, c)) candidates.push({ r, c, seq });
    }
  }
  if (!candidates.length || candidates.some((cand) => hasCapture(cand.seq))) return null;

  for (const cand of candidates) {
    const result = OzamaCheckers.applyMove(board, cand.r, cand.c, cand.seq);
    const nextMoves = [...moves, { fromR: cand.r, fromC: cand.c, seq: cand.seq, color }];
    const found = findNonCaptureLine(OzamaCheckers, result.board, OzamaCheckers.otherColor(color), depth - 1, nextMoves);
    if (found) return found;
  }
  return null;
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
  const OzamaCheckers = require('../public/checkers-engine.js');
  const line = findNonCaptureLine(OzamaCheckers, OzamaCheckers.createInitialBoard(), 'w', PLY_LIMIT, []);
  assert(line && line.length === PLY_LIMIT, `el motor real deberia encontrar una linea de ${PLY_LIMIT} jugadas sin captura desde el tablero inicial`);
  console.log(`Linea de ${PLY_LIMIT} jugadas sin captura encontrada contra el motor real.`);

  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'damas-noprogress-flow-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      OZAMA_NO_PROGRESS_PLY_LIMIT: String(PLY_LIMIT),
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
    const playerA = await register(`dnopA_${suffix}`);
    const playerB = await register(`dnopB_${suffix}`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    const createdA = waitEvent(sockA, 'damas:room-created');
    sockA.emit('damas:create-room', { playerName: playerA.user.username, country: 'DO' });
    const roomInfo = await createdA;

    const startA = waitEvent(sockA, 'damas:game-start');
    const startB = waitEvent(sockB, 'damas:game-start');
    sockB.emit('damas:join-room', { code: roomInfo.code, playerName: playerB.user.username, country: 'DO' });
    const [gsA, gsB] = await Promise.all([startA, startB]);
    const sockByColor = { [gsA.color]: sockA, [gsB.color]: sockB };
    console.log(`Partida creada: A=${gsA.color}, B=${gsB.color}.`);

    // Un final de partida disparado por una jugada normal (no-pieces,
    // no-moves, timeout via resign/admin, o el nuevo no-progress) viaja
    // DENTRO del propio damas:board-update (campo gameOver) -- server.js
    // solo emite un evento 'damas:game-over' SEPARADO para los finales
    // que no vienen de una jugada (resign/timeout/opponent-left/
    // admin-closed/draw-accept). Ver server.js:2767-2774.
    // Si alguna jugada de la linea (encontrada contra el motor real, no
    // deberia pasar) llegara a ser rechazada, esto la convierte en un
    // error claro en vez de un timeout mudo de 8s.
    sockA.on('damas:move-rejected', (p) => { throw new Error(`jugada de A rechazada: ${JSON.stringify(p)}`); });
    sockB.on('damas:move-rejected', (p) => { throw new Error(`jugada de B rechazada: ${JSON.stringify(p)}`); });

    let lastBoardUpdate = null;

    for (let i = 0; i < line.length; i++) {
      const mv = line[i];
      const mover = sockByColor[mv.color];
      const isLast = i === line.length - 1;
      const updateWaiter = waitEvent(mover === sockA ? sockB : sockA, 'damas:board-update');
      const selfUpdateWaiter = waitEvent(mover, 'damas:board-update').catch(() => null);
      mover.emit('damas:move', { room: roomInfo.code, fromR: mv.fromR, fromC: mv.fromC, seq: mv.seq });
      lastBoardUpdate = await updateWaiter;
      await selfUpdateWaiter; // esperar a que TAMBIEN el propio jugador reciba su eco antes de la siguiente jugada.
      if (isLast) {
        assert(lastBoardUpdate.gameOver && lastBoardUpdate.gameOver.reason === 'no-progress',
          `tras ${PLY_LIMIT} jugadas sin captura, board-update deberia traer gameOver.reason:'no-progress', vino ${JSON.stringify(lastBoardUpdate.gameOver)}`);
      } else {
        assert(!lastBoardUpdate.gameOver, `la jugada ${i + 1}/${PLY_LIMIT} NO deberia terminar la partida todavia, vino ${JSON.stringify(lastBoardUpdate.gameOver)}`);
      }
    }
    console.log(`Tras exactamente ${PLY_LIMIT} jugadas sin captura, el servidor corto la partida solo (reason:'no-progress').`);

    const gameOverPayload = lastBoardUpdate.gameOver;
    assert(gameOverPayload.winner === null, `winner deberia ser null (tablas), vino ${JSON.stringify(gameOverPayload.winner)}`);
    console.log('board-update final: winner:null, reason:"no-progress" -- confirmado.');

    sockA.close(); sockB.close();
    await wait(500); // margen para que finishDamasGame() termine de guardar (fire-and-forget desde el handler de move).

    // ── Verificar lo persistido: DamasMatch + ELO de ambos como tabla real ──
    process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
    process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
    const mongoose = require('mongoose');
    const connectDatabase = require('../config/database');
    const DamasMatch = require('../models/DamasMatch');
    const User = require('../models/User');
    await connectDatabase();

    const match = await DamasMatch.findOne({ roomCode: roomInfo.code }).lean();
    assert(match, `deberia existir un DamasMatch para la sala ${roomInfo.code}`);
    assert(match.result === 'draw' && match.reason === 'no-progress', `el partido guardado deberia ser result:'draw', reason:'no-progress', vino ${JSON.stringify({ result: match.result, reason: match.reason })}`);
    console.log('DamasMatch: se guardo result:"draw", reason:"no-progress".');

    const [userA, userB] = await Promise.all([
      User.findById(playerA.user.id).select('damasElo damasStats'),
      User.findById(playerB.user.id).select('damasElo damasStats'),
    ]);
    assert(userA.damasStats.draws === 1 && userB.damasStats.draws === 1, `ambos deberian sumar 1 tabla en damasStats, vino A=${userA.damasStats.draws} B=${userB.damasStats.draws}`);
    assert(userA.damasElo === 1200 && userB.damasElo === 1200, `dos jugadores del mismo ELO inicial en tablas no deberian cambiar de ELO, vino A=${userA.damasElo} B=${userB.damasElo}`);
    console.log(`ELO: ambos jugadores (mismo ELO inicial) quedaron en ${userA.damasElo} tras la tabla -- damasStats.draws=1 para los dos.`);

    await mongoose.disconnect();

    console.log('\n✅ DAMAS_NO_PROGRESS_DRAW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ DAMAS_NO_PROGRESS_DRAW_FAILED:', err.message);
  process.exit(1);
});
