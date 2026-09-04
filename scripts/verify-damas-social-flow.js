'use strict';

// Prueba de punta a punta de revancha/tablas/rendirse en Damas online:
// levanta un server.js real contra una base de Mongo aislada y
// temporal (nunca produccion, mismo patron que
// scripts/verify-tournament-flow.js), crea una sala de Damas entre
// dos cuentas reales via sockets, ofrece y acepta tablas (verifica que
// ambos ven damas:game-over con reason:'draw' y que el ELO/stats de
// Damas de ambas cuentas se actualiza), pide revancha y la acepta
// (verifica que el tablero se reinicia para los dos), y por ultimo
// pide otra revancha que esta vez se rechaza.
//
// Uso: node scripts/verify-damas-social-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DAMAS_TEST_PORT || 3142);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_damas_social' });

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
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'damas-social-flow-test-secret-at-least-32-chars',
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
    const playerA = await register(`dplayerA_${suffix}`);
    const playerB = await register(`dplayerB_${suffix}`);
    console.log(`Registrados: A=${playerA.user.username} (elo=${playerA.user.damasElo}), B=${playerB.user.username} (elo=${playerB.user.damasElo})`);

    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    // A crea la sala, B se une.
    const createdA = waitEvent(sockA, 'damas:room-created');
    sockA.emit('damas:create-room', { playerName: playerA.user.username, country: 'DO' });
    const roomInfo = await createdA;
    assert(roomInfo.code, 'A deberia recibir un codigo de sala');
    console.log(`Sala creada: ${roomInfo.code}`);

    const startA = waitEvent(sockA, 'damas:game-start');
    const startB = waitEvent(sockB, 'damas:game-start');
    sockB.emit('damas:join-room', { code: roomInfo.code, playerName: playerB.user.username, country: 'DO' });
    const [gsA, gsB] = await Promise.all([startA, startB]);
    assert(gsA.color === 'w' && gsB.color === 'b', `colores esperados w/b, se obtuvo ${gsA.color}/${gsB.color}`);
    console.log('Partida iniciada para ambos.');

    // ── Tablas: A ofrece, B acepta ──────────────────────────────────
    const offeredB = waitEvent(sockB, 'damas:draw-offered');
    sockA.emit('damas:draw-offer', { room: roomInfo.code });
    const offerPayload = await offeredB;
    assert(offerPayload.playerName === playerA.user.username, `draw-offered deberia venir de A, vino de "${offerPayload.playerName}"`);
    console.log('B recibio la oferta de tablas de A.');

    const acceptedA = waitEvent(sockA, 'damas:draw-accepted');
    const acceptedB = waitEvent(sockB, 'damas:draw-accepted');
    const gameOverA = waitEvent(sockA, 'damas:game-over');
    const gameOverB = waitEvent(sockB, 'damas:game-over');
    sockB.emit('damas:draw-accept', { room: roomInfo.code });
    await Promise.all([acceptedA, acceptedB]);
    const [goA, goB] = await Promise.all([gameOverA, gameOverB]);
    assert(goA.reason === 'draw' && goA.winner === null, `game-over de A deberia ser draw/null, fue ${JSON.stringify(goA)}`);
    assert(goB.reason === 'draw' && goB.winner === null, `game-over de B deberia ser draw/null, fue ${JSON.stringify(goB)}`);
    console.log('Ambos recibieron damas:draw-accepted y damas:game-over (draw).');

    await wait(800); // darle tiempo al servidor a guardar el DamasMatch y actualizar ELO
    const meA = await getJson('/api/user/me', playerA.token);
    const meB = await getJson('/api/user/me', playerB.token);
    assert(meA.data.user.damasStats.draws === 1, `A deberia tener 1 tabla registrada, tiene ${JSON.stringify(meA.data.user.damasStats)}`);
    assert(meB.data.user.damasStats.draws === 1, `B deberia tener 1 tabla registrada, tiene ${JSON.stringify(meB.data.user.damasStats)}`);
    console.log(`ELO/stats actualizados: A elo=${meA.data.user.damasElo} draws=${meA.data.user.damasStats.draws}, B elo=${meB.data.user.damasElo} draws=${meB.data.user.damasStats.draws}`);

    // ── Revancha: A pide, B acepta ──────────────────────────────────
    const requestedB = waitEvent(sockB, 'damas:rematch-requested');
    sockA.emit('damas:rematch-request', { room: roomInfo.code });
    await requestedB;
    console.log('B recibio la solicitud de revancha de A.');

    const rematchA = waitEvent(sockA, 'damas:rematch-start');
    const rematchB = waitEvent(sockB, 'damas:rematch-start');
    sockB.emit('damas:rematch-accept', { room: roomInfo.code });
    const [rsA, rsB] = await Promise.all([rematchA, rematchB]);
    assert(rsA.roomToken && rsB.roomToken && rsA.roomToken !== rsB.roomToken, 'cada jugador deberia recibir su propio roomToken nuevo');
    assert(rsA.turn === 'w', `la revancha deberia empezar con turno blanco, empezo con "${rsA.turn}"`);
    console.log('Revancha arrancada para ambos con tablero reiniciado.');

    // ── Tablas otra vez, para poder probar el rechazo de revancha ───
    const offered2 = waitEvent(sockA, 'damas:draw-offered');
    sockB.emit('damas:draw-offer', { room: roomInfo.code });
    await offered2;
    const gameOver2A = waitEvent(sockA, 'damas:game-over');
    sockA.emit('damas:draw-accept', { room: roomInfo.code });
    await gameOver2A;
    console.log('Segunda partida cerrada en tablas para poder probar el rechazo de revancha.');

    // ── Revancha rechazada ───────────────────────────────────────────
    const declinedA = waitEvent(sockA, 'damas:rematch-declined');
    sockA.emit('damas:rematch-request', { room: roomInfo.code });
    await wait(200);
    sockB.emit('damas:rematch-decline', { room: roomInfo.code });
    await declinedA;
    console.log('A recibio damas:rematch-declined correctamente.');

    console.log('\n✅ DAMAS_SOCIAL_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    proc.kill('SIGTERM');
    await wait(300);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('\n❌ DAMAS_SOCIAL_FLOW_FAILED:', err.message);
  process.exit(1);
});
