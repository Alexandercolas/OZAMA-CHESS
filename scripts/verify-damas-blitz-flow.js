'use strict';

// Prueba de punta a punta de Blitz para Damas (Fase 2 del roadmap
// "OZAMA PRO - FASE FINAL"): antes de esta fase Damas no tenia reloj
// en absoluto (ninguna partida, ni siquiera online, tenia limite de
// tiempo). Levanta un server.js real contra una Mongo aislada y
// temporal (nunca produccion) y verifica:
//
//   - crear sala con un ritmo elegido aplica ese reloj de verdad;
//   - el reloj tickea de verdad (damas:clock-tick) y decrementa;
//   - el incremento se acredita a quien ACABA de mover, no al rival;
//   - desconectarse PAUSA el reloj (no sigue corriendo mientras el
//     rival espera los 30s de gracia) y reconectarse lo retoma sin
//     reiniciarlo;
//   - un torneo de Damas con timeControl:"3+0" hace que el partido
//     arranque de verdad con 3 minutos.
//
// Uso: node scripts/verify-damas-blitz-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DAMAS_BLITZ_TEST_PORT || 3144);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_damas_blitz' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const serverLines = [];
  const adminSuffix = String(Date.now()).slice(-8);
  const adminUsername = `dblitzadmin_${adminSuffix}`;
  const adminEmail = `${adminUsername.toLowerCase()}@example.test`;

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'damas-blitz-flow-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      ADMIN_EMAILS: adminEmail,
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
    const playerA = await register(`dblitzA_${suffix}`);
    const playerB = await register(`dblitzB_${suffix}`);
    console.log(`Registrados: A=${playerA.user.username}, B=${playerB.user.username}`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    // ── Sala con ritmo "2+1" -- reloj inicial correcto ──────────────
    const createdA = waitEvent(sockA, 'damas:room-created');
    sockA.emit('damas:create-room', { playerName: playerA.user.username, country: 'DO', timeControl: '2+1' });
    const roomInfo = await createdA;
    assert(roomInfo.timeControl === '2+1', `la sala deberia quedar con timeControl "2+1", vino "${roomInfo.timeControl}"`);

    const startA = waitEvent(sockA, 'damas:game-start');
    const startB = waitEvent(sockB, 'damas:game-start');
    sockB.emit('damas:join-room', { code: roomInfo.code, playerName: playerB.user.username, country: 'DO' });
    const [gsA, gsB] = await Promise.all([startA, startB]);
    assert(gsA.clockW === 2 * 60000 && gsA.clockB === 2 * 60000, `el reloj inicial deberia ser 2 minutos, fue ${JSON.stringify({ w: gsA.clockW, b: gsA.clockB })}`);
    assert(gsA.timeControl === '2+1', 'ambos deberian recibir timeControl "2+1"');
    console.log(`Sala "2+1": reloj inicial correcto (${gsA.clockW}ms), color A=${gsA.color} B=${gsB.color}.`);

    // ── El reloj tickea de verdad ────────────────────────────────────
    const tick1 = await waitEvent(sockA, 'damas:clock-tick', 3000);
    assert(tick1.w === 2 * 60000 - 1000 || tick1.b === 2 * 60000 - 1000, `el primer tick deberia restar 1s a quien tiene el turno (blancas), vino ${JSON.stringify(tick1)}`);
    console.log('damas:clock-tick decrementa de verdad cada segundo.');

    // ── Incremento: quien mueve gana +1s ─────────────────────────────
    const whiteSock = gsA.color === 'w' ? sockA : sockB;
    const blackClockBefore = tick1.b;
    const opponentUpdateWaiter = waitEvent(gsA.color === 'w' ? sockB : sockA, 'damas:board-update');
    // Blancas mueve una pieza de la fila 5 hacia la fila 4 (jugada legal
    // de apertura estandar en Damas dominicana).
    whiteSock.emit('damas:move', { room: roomInfo.code, fromR: 5, fromC: 0, seq: [{ toR: 4, toC: 1, capturedR: -1, capturedC: -1 }] });
    const boardUpdate = await opponentUpdateWaiter;
    assert(boardUpdate.clockW >= 2 * 60000 - 1000, `el incremento deberia mantener el reloj de blancas cerca de su valor inicial tras la primera jugada, fue ${boardUpdate.clockW}`);
    assert(boardUpdate.clockB === blackClockBefore, 'el reloj de negras NO deberia recibir el incremento de la jugada de blancas');
    console.log(`Incremento aplicado a quien movio: reloj blancas=${boardUpdate.clockW}ms tras jugar.`);

    // ── Desconexion pausa el reloj; reconexion lo retoma ────────────
    const clockBeforeDisconnect = boardUpdate.clockB;
    const whiteIsA = whiteSock === sockA;
    const whiteToken = whiteIsA ? playerA.token : playerB.token;
    const whiteRoomToken = (gsA.color === 'w' ? gsA : gsB).roomToken;
    const otherSock = whiteIsA ? sockB : sockA;
    const opponentDisconnectedWaiter = waitEvent(otherSock, 'damas:opponent-disconnected');
    whiteSock.disconnect();
    await opponentDisconnectedWaiter;
    await wait(2000); // si el reloj siguiera corriendo, esto ya se notaria

    // No hay forma de leer room.clockB desde afuera del proceso -- se
    // verifica reconectando como el MISMO jugador (blancas) y
    // confirmando que el reloj de negras que llega en el game-start
    // del rejoin es identico al de antes de desconectarse (no seguio
    // corriendo durante la pausa).
    const rejoinSocket = io(baseUrl, { auth: { token: whiteToken }, reconnection: false, timeout: 5000 });
    sockets.push(rejoinSocket);
    await waitEvent(rejoinSocket, 'connect');
    const rejoinStart = waitEvent(rejoinSocket, 'damas:game-start');
    rejoinSocket.emit('damas:rejoin', { room: roomInfo.code, color: 'w', token: whiteRoomToken });
    const rejoinData = await rejoinStart;
    assert(rejoinData.clockB === clockBeforeDisconnect, `el reloj de negras deberia seguir igual tras la pausa (${clockBeforeDisconnect}), vino ${rejoinData.clockB}`);
    console.log(`Reconexion: el reloj de negras se mantuvo pausado en ${rejoinData.clockB}ms, no siguio corriendo.`);

    sockA.close(); sockB.close(); rejoinSocket.close();

    // ── Torneo de Damas con timeControl "3+0" ───────────────────────
    const admin = await register(adminUsername);
    const created = await postJson('/api/admin/events', {
      title: 'Damas Blitz de prueba', type: 'tournament', gameType: 'checkers', status: 'published', maxPlayers: 2, timeControl: '3+0',
    }, admin.token);
    assert(created.status === 201, `crear torneo -> ${created.status} ${JSON.stringify(created.data)}`);
    const eventId = created.data.event._id;

    const joinA = await postJson(`/api/events/${eventId}/join`, {}, playerA.token);
    assert(joinA.status === 200, `join A -> ${joinA.status} ${JSON.stringify(joinA.data)}`);
    const joinB = await postJson(`/api/events/${eventId}/join`, {}, playerB.token);
    assert(joinB.status === 200, `join B -> ${joinB.status} ${JSON.stringify(joinB.data)}`);

    const bracketRes = await postJson(`/api/admin/events/${eventId}/bracket/generate`, {}, admin.token);
    assert(bracketRes.status === 200, `generar bracket -> ${bracketRes.status} ${JSON.stringify(bracketRes.data)}`);

    const tSockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const tSockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(tSockA, tSockB);
    await Promise.all([waitEvent(tSockA, 'connect'), waitEvent(tSockB, 'connect')]);

    const readyA = waitEvent(tSockA, 'tournament:damas-match-ready');
    tSockA.emit('tournament:join-match-damas', { eventId, round: 0, matchIndex: 0 });
    const matchReadyA = await readyA;
    const readyB = waitEvent(tSockB, 'tournament:damas-match-ready');
    tSockB.emit('tournament:join-match-damas', { eventId, round: 0, matchIndex: 0 });
    const matchReadyB = await readyB;

    const rejoinAWaiter = waitEvent(tSockA, 'damas:game-start');
    tSockA.emit('damas:rejoin', { room: matchReadyA.code, color: matchReadyA.color, token: matchReadyA.roomToken });
    const tGsA = await rejoinAWaiter;
    const rejoinBWaiter = waitEvent(tSockB, 'damas:game-start');
    tSockB.emit('damas:rejoin', { room: matchReadyB.code, color: matchReadyB.color, token: matchReadyB.roomToken });
    const tGsB = await rejoinBWaiter;

    assert(tGsA.timeControl === '3+0' && tGsB.timeControl === '3+0', `el partido de torneo de Damas deberia usar "3+0", vino ${tGsA.timeControl}/${tGsB.timeControl}`);
    assert(tGsA.clockW === 3 * 60000, `el reloj del partido de torneo de Damas deberia ser 3 minutos, fue ${tGsA.clockW}`);
    console.log('Torneo de Damas "3+0": el partido arranco de verdad con reloj de 3 minutos.');

    console.log('\n✅ DAMAS_BLITZ_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ DAMAS_BLITZ_FLOW_FAILED:', err.message);
  process.exit(1);
});
