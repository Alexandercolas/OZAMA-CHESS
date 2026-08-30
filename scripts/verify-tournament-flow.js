'use strict';

// Prueba de punta a punta del sistema de torneos: levanta un server.js
// real contra una base de Mongo aislada y temporal (nunca produccion,
// mismo patron que scripts/dynamic-security-check.js), crea un
// torneo de 2 jugadores, genera el bracket, hace que ambos entren a
// su partido via sockets reales, uno de los dos se rinde, y verifica
// que el bracket avanza y corona al campeon correcto.
//
// Uso: node scripts/verify-tournament-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_TOURNAMENT_TEST_PORT || 3141);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_tournament' });

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
  const adminUsername = `tadmin_${adminSuffix}`;
  const adminEmail = `${adminUsername.toLowerCase()}@example.test`;

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'tournament-flow-test-secret-at-least-32-chars',
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

    const admin = await register(adminUsername);
    const suffix = String(Date.now()).slice(-8);
    const playerA = await register(`tplayerA_${suffix}`);
    const playerB = await register(`tplayerB_${suffix}`);
    console.log(`Registrados: admin=${admin.user.username}, A=${playerA.user.username}, B=${playerB.user.username}`);

    // Crear el torneo como admin
    const created = await postJson('/api/admin/events', {
      title: 'Torneo de prueba', type: 'tournament', status: 'published', maxPlayers: 2,
    }, admin.token);
    assert(created.status === 201, `crear evento -> ${created.status} ${JSON.stringify(created.data)}`);
    const eventId = created.data.event._id;
    console.log(`Torneo creado: ${eventId}`);

    // Inscribir a los dos jugadores
    const joinA = await postJson(`/api/events/${eventId}/join`, {}, playerA.token);
    assert(joinA.status === 200, `join A -> ${joinA.status} ${JSON.stringify(joinA.data)}`);
    const joinB = await postJson(`/api/events/${eventId}/join`, {}, playerB.token);
    assert(joinB.status === 200, `join B -> ${joinB.status} ${JSON.stringify(joinB.data)}`);
    console.log('Ambos jugadores inscritos.');

    // Generar el bracket
    const bracketRes = await postJson(`/api/admin/events/${eventId}/bracket/generate`, {}, admin.token);
    assert(bracketRes.status === 200, `generar bracket -> ${bracketRes.status} ${JSON.stringify(bracketRes.data)}`);
    const firstMatch = bracketRes.data.event.bracket.rounds[0].matches[0];
    assert(firstMatch.status === 'ready', `partido deberia estar 'ready', esta '${firstMatch.status}'`);
    console.log(`Bracket generado: ${firstMatch.player1Name} vs ${firstMatch.player2Name}`);

    // Confirmar que cada jugador ve su "yourMatch"
    const detailA = await getJson(`/api/events/${eventId}`, playerA.token);
    assert(detailA.data.yourMatch, 'playerA deberia tener yourMatch');
    assert(detailA.data.yourMatch.round === 0 && detailA.data.yourMatch.matchIndex === 0, 'yourMatch de A deberia ser ronda 0, partido 0');
    console.log('GET /api/events/:id devuelve yourMatch correctamente para A.');

    // Ambos entran a su partido via socket
    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    const readyA = waitEvent(sockA, 'game-start');
    sockA.emit('tournament:join-match', { eventId, round: 0, matchIndex: 0 });
    const gameStartA1 = await readyA;
    assert(gameStartA1.code, 'A deberia recibir un roomCode al entrar primero');
    console.log(`A entro primero -- sala ${gameStartA1.code}, color ${gameStartA1.color}`);

    const readyBothB = waitEvent(sockB, 'game-start');
    const readyBothA = waitEvent(sockA, 'game-start');
    sockB.emit('tournament:join-match', { eventId, round: 0, matchIndex: 0 });
    const [gameStartB, gameStartA2] = await Promise.all([readyBothB, readyBothA]);
    assert(gameStartB.code === gameStartA1.code, 'B deberia entrar a la MISMA sala que A');
    assert(gameStartB.color !== gameStartA2.color, 'A y B deberian tener colores distintos');
    console.log(`B entro -- mismo codigo confirmado (${gameStartB.code}), colores: A=${gameStartA2.color} B=${gameStartB.color}`);

    // A se rinde -- B deberia ganar el partido y coronarse campeon
    // (torneo de 2, una sola ronda).
    const loserSock = gameStartA2.color === 'w' ? sockA : sockB;
    const winnerUsername = gameStartA2.color === 'w' ? playerB.user.username : playerA.user.username;
    loserSock.emit('player-resign', { room: gameStartA1.code, pgn: '' });
    await wait(1500); // darle tiempo al servidor a cerrar el match y avanzar el bracket

    const finalDetail = await getJson(`/api/events/${eventId}`);
    const championName = finalDetail.data.event.bracket.championName;
    assert(championName === winnerUsername, `campeon esperado "${winnerUsername}", se obtuvo "${championName}"`);
    assert(finalDetail.data.event.status === 'finished', `el torneo deberia quedar 'finished', quedo '${finalDetail.data.event.status}'`);
    console.log(`Campeon coronado correctamente: ${championName}. Torneo status: ${finalDetail.data.event.status}`);

    console.log('\n✅ TOURNAMENT_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    proc.kill('SIGTERM');
    await wait(300);
    if (proc.exitCode === null) proc.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('\n❌ TOURNAMENT_FLOW_FAILED:', err.message);
  process.exit(1);
});
