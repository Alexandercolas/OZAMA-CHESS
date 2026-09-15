'use strict';

// Prueba de "Experiencia de partida" (Fase 18 del roadmap "OZAMA
// PRO"): auditoria (comparando contra Ajedrez, donde rejoin() ya se
// disparaba en CUALQUIER reconexion via socket.on('connect', rejoin))
// encontro un bug real en Damas: damas:rejoin SOLO se disparaba desde
// attemptAutoRejoin() al cargar la pagina -- un corte de red real a
// mitad de partida (Wifi, telefono en segundo plano) reconectaba el
// socket de Socket.IO solo, pero el cliente nunca volvia a entrar a
// la sala en el servidor, asi que el jugador perdia por abandono a
// los 30s sin ningun aviso ni forma de evitarlo salvo refrescar la
// pagina por su cuenta. El fix (damas.html) hace que el propio
// handler de 'connect' (que YA se dispara en cualquier reconexion)
// tambien reintente damas:rejoin si habia una partida en curso, mas
// un overlay "CONEXION PERDIDA / Reconectando..." (reusa el mismo
// overlay + cuenta regresiva de 30s que ya existia para el rival).
//
// Este script no puede ejecutar el JavaScript de damas.html en si
// (no hay navegador real) -- en su lugar, verifica el CONTRATO del
// servidor del que depende ese fix: contra un server.js real y una
// Mongo aislada y temporal (nunca produccion), simula exactamente lo
// que el navegador hace en un corte de red real (el socket se
// desconecta, una conexion NUEVA llama a damas:rejoin) y confirma:
//
//   - el rival ve damas:opponent-disconnected cuando el socket se cae;
//   - una conexion NUEVA con damas:rejoin (mismo patron que ahora usa
//     el handler de 'connect' de damas.html) recupera el asiento,
//     recibe damas:game-start con el tablero real, y el rival recibe
//     damas:opponent-reconnected;
//   - la partida sigue siendo jugable de verdad despues (una jugada
//     real pasa y el rival la ve) -- no solo "el evento llego", sino
//     que el juego en si sigue funcionando;
//   - el reloj se pauso durante el corte y NO seguia corriendo
//     (mismo comportamiento que ya prueba verify-damas-blitz-flow.js
//     para el lado del RIVAL, aca confirmado para el lado que se
//     reconecta).
//
// Uso: node scripts/verify-damas-reconnect-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DAMAS_RECONNECT_TEST_PORT || 3230);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_dreconn' });

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
      JWT_SECRET: process.env.JWT_SECRET || 'damas-reconnect-flow-test-secret-at-least-32',
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
    const playerA = await register(`dreconnA_${suffix}`);
    const playerB = await register(`dreconnB_${suffix}`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    const createdA = waitEvent(sockA, 'damas:room-created');
    sockA.emit('damas:create-room', { playerName: playerA.user.username, country: 'DO', timeControl: '5+0' });
    const roomInfo = await createdA;

    const startA = waitEvent(sockA, 'damas:game-start');
    const startB = waitEvent(sockB, 'damas:game-start');
    sockB.emit('damas:join-room', { code: roomInfo.code, playerName: playerB.user.username, country: 'DO' });
    const [gsA, gsB] = await Promise.all([startA, startB]);
    const aColor = gsA.color;
    const aToken = gsA.roomToken;
    console.log(`Partida creada: A=${aColor}, B=${gsB.color}, sala ${roomInfo.code}.`);

    // ═══════ Simular el corte de red: A se desconecta de golpe ═══════
    const bSeesDisconnect = waitEvent(sockB, 'damas:opponent-disconnected');
    sockA.disconnect();
    await bSeesDisconnect;
    console.log('reconnect: al caerse el socket de A, B recibe damas:opponent-disconnected (grace period de 30s arranca).');

    await wait(1500); // simula que el corte dura un momento real, no instantaneo

    // ═══════ "El navegador reconecta solo" -- conexion NUEVA + damas:rejoin ═══════
    // Esto es EXACTAMENTE lo que ahora hace el handler de 'connect' de
    // damas.html automaticamente: una conexion Socket.IO nueva (mismo
    // comportamiento que un reconnect real) seguida de damas:rejoin
    // con los datos de la sesion -- ya no hace falta refrescar la
    // pagina para que esto pase.
    const sockA2 = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA2);
    await waitEvent(sockA2, 'connect');

    const rejoinStart = waitEvent(sockA2, 'damas:game-start');
    const bSeesReconnect = waitEvent(sockB, 'damas:opponent-reconnected');
    sockA2.emit('damas:rejoin', { room: roomInfo.code, color: aColor, token: aToken });
    const [rejoinData] = await Promise.all([rejoinStart, bSeesReconnect]);

    assert(rejoinData.code === roomInfo.code, `el rejoin deberia devolver la MISMA sala, vino ${rejoinData.code}`);
    assert(Array.isArray(rejoinData.board) && rejoinData.board.length === 8, 'el rejoin deberia devolver el tablero real (8x8), no uno vacio');
    assert(rejoinData.clockW === gsA.clockW, `el reloj no deberia haber avanzado durante el corte (pausado), antes ${gsA.clockW} ahora ${rejoinData.clockW}`);
    console.log('reconnect: una conexion NUEVA + damas:rejoin recupera el asiento -- B recibe damas:opponent-reconnected, el reloj siguio pausado durante el corte.');

    // ═══════ La partida sigue siendo jugable de verdad tras reconectar ═══════
    const wSock = aColor === 'w' ? sockA2 : sockB;
    const bSockForMove = aColor === 'w' ? sockB : sockA2;
    const boardUpdateWaiter = waitEvent(bSockForMove, 'damas:board-update');
    wSock.emit('damas:move', { room: roomInfo.code, fromR: 5, fromC: 0, seq: [{ toR: 4, toC: 1, capturedR: -1, capturedC: -1 }] });
    const boardUpdate = await boardUpdateWaiter;
    assert(boardUpdate.board[4][1] && boardUpdate.board[4][1].color === 'w', 'la jugada real despues de reconectar deberia reflejarse en el tablero de ambos');
    console.log('reconnect: la partida sigue jugable de verdad despues de reconectar -- una jugada real llega al rival.');

    console.log('\n✅ DAMAS_RECONNECT_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ DAMAS_RECONNECT_FLOW_FAILED:', err.message);
  process.exit(1);
});
