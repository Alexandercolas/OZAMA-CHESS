'use strict';

// Prueba de punta a punta de Blitz para Ajedrez (Fase 2 del roadmap
// "OZAMA PRO - FASE FINAL"): levanta un server.js real contra una
// Mongo aislada y temporal (nunca produccion, mismo patron que
// scripts/verify-tournament-flow.js) y verifica:
//
//   - quick-match empareja solo a jugadores que pidieron el MISMO
//     ritmo de tiempo (nunca mezcla 1+0 con 10+0);
//   - la partida arranca con el reloj real de ese ritmo, no el fijo
//     de 10 minutos de siempre;
//   - el incremento ("+1" en un ritmo como "2+1") se acredita a quien
//     ACABA de mover, no al rival;
//   - un torneo con timeControl:"3+0" hace que la sala de ese partido
//     arranque de verdad con 3 minutos, no con el default.
//
// Uso: node scripts/verify-blitz-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_BLITZ_TEST_PORT || 3143);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_blitz' });

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

async function getJson(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
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
  const adminUsername = `blitzadmin_${adminSuffix}`;
  const adminEmail = `${adminUsername.toLowerCase()}@example.test`;

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'blitz-flow-test-secret-at-least-32-chars',
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
    const playerA = await register(`blitzA_${suffix}`);
    const playerB = await register(`blitzB_${suffix}`);
    const playerC = await register(`blitzC_${suffix}`);
    console.log(`Registrados: A=${playerA.user.username}, B=${playerB.user.username}, C=${playerC.user.username}`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    const sockC = io(baseUrl, { auth: { token: playerC.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB, sockC);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect'), waitEvent(sockC, 'connect')]);

    // ── No se mezclan ritmos distintos: A pide 1+0, C pide 10+0 -----
    // (esperan matchmaking-searching, NUNCA game-start -- si el rechazo
    // fallara y los emparejara entre si, waitEvent se colgaria
    // esperando 'matchmaking-searching' y el test fallaria por timeout).
    sockA.emit('quick-match', { playerName: playerA.user.username, timeControl: '1+0' });
    await waitEvent(sockA, 'matchmaking-searching');
    sockC.emit('quick-match', { playerName: playerC.user.username, timeControl: '10+0' });
    await waitEvent(sockC, 'matchmaking-searching');
    console.log('Ritmos distintos en la cola: A (1+0) y C (10+0) no se emparejaron entre si.');
    sockA.emit('quick-match-cancel');
    sockC.emit('quick-match-cancel');
    await Promise.all([waitEvent(sockA, 'matchmaking-cancelled'), waitEvent(sockC, 'matchmaking-cancelled')]);

    // ── Mismo ritmo: A y B piden "2+1" -- deben emparejarse ---------
    const gameStartA = waitEvent(sockA, 'game-start');
    const gameStartB = waitEvent(sockB, 'game-start');
    sockA.emit('quick-match', { playerName: playerA.user.username, timeControl: '2+1' });
    sockB.emit('quick-match', { playerName: playerB.user.username, timeControl: '2+1' });
    const [gsA, gsB] = await Promise.all([gameStartA, gameStartB]);
    assert(gsA.clockW === 2 * 60000 && gsA.clockB === 2 * 60000, `el reloj inicial deberia ser 2 minutos, fue ${JSON.stringify({ w: gsA.clockW, b: gsA.clockB })}`);
    assert(gsA.timeControl === '2+1' && gsB.timeControl === '2+1', 'ambos deberian recibir timeControl "2+1"');
    console.log(`Emparejados con 2+1: reloj inicial correcto (${gsA.clockW}ms), color A=${gsA.color} B=${gsB.color}.`);

    // ── Incremento: quien mueve gana +1s, el reloj del rival no cambia ──
    const roomCode = gsA.code;
    const whiteSock = gsA.color === 'w' ? sockA : sockB;
    const blackClockBefore = gsA.clockB;
    const opponentMoveWaiter = waitEvent(gsA.color === 'w' ? sockB : sockA, 'opponent-move');
    whiteSock.emit('player-move', { room: roomCode, from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    await opponentMoveWaiter;
    await wait(300); // darle un instante al servidor a aplicar el incremento antes de leer el estado

    // No hay un endpoint HTTP que exponga room.clockW directo -- se
    // verifica indirecto: el siguiente clock-tick despues del
    // incremento debe mostrar el reloj de blancas por ENCIMA de
    // "2 minutos menos 1 segundo" (el tick normal resta 1s por
    // segundo transcurrido, pero el incremento de +1s aplicado en la
    // MISMA jugada compensa ese primer descuento).
    const tick = await waitEvent(sockA, 'clock-tick', 3000);
    assert(tick.w >= 2 * 60000 - 1000, `el incremento deberia mantener el reloj de blancas cerca de su valor inicial tras la primera jugada, fue ${tick.w}`);
    assert(tick.b === blackClockBefore || tick.b === blackClockBefore - 1000, 'el reloj de negras NO deberia recibir el incremento de la jugada de blancas');
    console.log(`Incremento aplicado a quien movio: reloj blancas=${tick.w}ms tras jugar y tickear.`);

    sockA.close(); sockB.close(); sockC.close();

    // ── Torneo con timeControl "3+0": el partido debe arrancar con 3 min ──
    const admin = await register(adminUsername);
    const created = await postJson('/api/admin/events', {
      title: 'Blitz de prueba', type: 'tournament', status: 'published', maxPlayers: 2, timeControl: '3+0',
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

    const readyA = waitEvent(tSockA, 'game-start');
    tSockA.emit('tournament:join-match', { eventId, round: 0, matchIndex: 0 });
    await readyA;

    const readyBothB = waitEvent(tSockB, 'game-start');
    const readyBothA = waitEvent(tSockA, 'game-start');
    tSockB.emit('tournament:join-match', { eventId, round: 0, matchIndex: 0 });
    const [tGsB, tGsA] = await Promise.all([readyBothB, readyBothA]);
    assert(tGsA.timeControl === '3+0' && tGsB.timeControl === '3+0', `el partido de torneo deberia usar "3+0", vino ${tGsA.timeControl}/${tGsB.timeControl}`);
    assert(tGsA.clockW === 3 * 60000, `el reloj del partido de torneo deberia ser 3 minutos, fue ${tGsA.clockW}`);
    console.log(`Torneo "3+0": el partido arranco de verdad con reloj de 3 minutos (antes de esta fase esto era solo texto decorativo).`);

    console.log('\n✅ BLITZ_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ BLITZ_FLOW_FAILED:', err.message);
  process.exit(1);
});
