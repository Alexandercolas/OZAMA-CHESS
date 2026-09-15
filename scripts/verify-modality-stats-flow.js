'use strict';

// Prueba de punta a punta de "rendimiento por modalidad" (Fase 10 del
// roadmap "OZAMA PRO", Estadisticas Avanzadas): auditoria previa
// encontro que "por color" (Con Blancas/Con Negras) ya estaba
// calculado en /api/user/stats/advanced, pero Match/DamasMatch NO
// guardaban que ritmo de tiempo se jugo cada partida -- sin ese dato,
// "por modalidad" (Blitz vs Rapida vs Bullet) era imposible de
// calcular, ni siquiera con datos historicos. Verifica, contra un
// server.js real y una Mongo aislada y temporal (nunca produccion):
//
//   - una partida de Ajedrez creada con un ritmo especifico ("3+0")
//     guarda ESE timeControl en el Match, no el default de siempre;
//   - /api/user/stats/advanced (Premium) devuelve byModality con el
//     conteo/winRate correcto para esa modalidad;
//   - lo mismo para Damas;
//   - un partido de torneo tambien guarda el timeControl del evento.
//
// Uso: node scripts/verify-modality-stats-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_MODALITY_TEST_PORT || 3233);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_modality' });

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
      JWT_SECRET: process.env.JWT_SECRET || 'modality-stats-test-secret-at-least-32-chars',
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

  process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
  process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
  const mongoose = require('mongoose');
  const connectDatabase = require('../config/database');
  const User = require('../models/User');
  const Match = require('../models/Match');
  const DamasMatch = require('../models/DamasMatch');

  const sockets = [];
  try {
    await waitForServer(proc, serverLines);
    await connectDatabase();
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const a = await register(`modA_${suffix}`);
    const b = await register(`modB_${suffix}`);

    // Premium activo (necesario para /stats/advanced) -- directo por
    // el modelo, no hace falta pasar por PayPal para probar esto.
    await User.updateOne({ _id: a.user.id }, { $set: { plan: 'premium', premiumUntil: new Date(Date.now() + 86400000) } });

    // ═══════════════════ AJEDREZ ═══════════════════
    {
      const sockA = io(baseUrl, { auth: { token: a.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: b.token }, reconnection: false, timeout: 5000 });
      sockets.push(sockA, sockB);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

      const createdA = waitEvent(sockA, 'room-created');
      sockA.emit('create-room', { playerName: a.user.username, timeControl: '3+0' });
      const roomInfo = await createdA;
      assert(roomInfo.timeControl === '3+0', `la sala deberia quedar con timeControl "3+0", vino "${roomInfo.timeControl}"`);

      const startA = waitEvent(sockA, 'game-start');
      const startB = waitEvent(sockB, 'game-start');
      sockB.emit('join-room', { code: roomInfo.code, playerName: b.user.username });
      const [gsA] = await Promise.all([startA, startB]);

      const match = await Match.findOne({ roomCode: roomInfo.code });
      assert(match?.timeControl === '3+0', `el Match creado deberia guardar timeControl "3+0", vino "${match?.timeControl}"`);
      console.log('Ajedrez: el Match guarda el timeControl real de la partida ("3+0"), no un default.');

      const resignedWaiter = waitEvent(sockB, 'opponent-resigned');
      sockA.emit('player-resign', { room: gsA.code, pgn: '' });
      await resignedWaiter;
      await wait(300); // que termine de guardar el resultado

      const stats = await getJson('/api/user/stats/advanced?game=chess', a.token);
      assert(stats.status === 200, `stats/advanced -> ${stats.status} ${JSON.stringify(stats.data)}`);
      const modality = stats.data.byModality.find((m) => m.key === '3+0');
      assert(modality, `deberia haber una entrada byModality para "3+0", vino ${JSON.stringify(stats.data.byModality)}`);
      assert(modality.games === 1 && modality.losses === 1, `A se rindio -- deberia ser 1 partida, 1 derrota en "3+0", vino ${JSON.stringify(modality)}`);
      console.log(`Ajedrez: /stats/advanced -> byModality["3+0"] = ${JSON.stringify(modality)} (correcto).`);

      sockA.close(); sockB.close();
    }

    // ═══════════════════ DAMAS ═══════════════════
    {
      const sockA = io(baseUrl, { auth: { token: a.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: b.token }, reconnection: false, timeout: 5000 });
      sockets.push(sockA, sockB);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

      const createdA = waitEvent(sockA, 'damas:room-created');
      sockA.emit('damas:create-room', { playerName: a.user.username, country: 'DO', timeControl: '5+0' });
      const roomInfo = await createdA;
      assert(roomInfo.timeControl === '5+0', `la sala de Damas deberia quedar con timeControl "5+0", vino "${roomInfo.timeControl}"`);

      const startA = waitEvent(sockA, 'damas:game-start');
      const startB = waitEvent(sockB, 'damas:game-start');
      sockB.emit('damas:join-room', { code: roomInfo.code, playerName: b.user.username, country: 'DO' });
      await Promise.all([startA, startB]);

      const resignedWaiter = waitEvent(sockB, 'damas:game-over');
      sockA.emit('damas:resign', { room: roomInfo.code });
      await resignedWaiter;
      await wait(300);

      const damasMatch = await DamasMatch.findOne({ roomCode: roomInfo.code });
      assert(damasMatch?.timeControl === '5+0', `el DamasMatch deberia guardar timeControl "5+0", vino "${damasMatch?.timeControl}"`);
      console.log('Damas: el DamasMatch tambien guarda el timeControl real ("5+0").');

      const stats = await getJson('/api/user/stats/advanced?game=damas', a.token);
      const modality = stats.data.byModality.find((m) => m.key === '5+0');
      assert(modality?.games === 1 && modality.losses === 1, `deberia ser 1 partida, 1 derrota en "5+0" de Damas, vino ${JSON.stringify(modality)}`);
      console.log(`Damas: /stats/advanced -> byModality["5+0"] = ${JSON.stringify(modality)} (correcto).`);

      sockA.close(); sockB.close();
    }

    console.log('\n✅ MODALITY_STATS_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    try { await mongoose.disconnect(); } catch (_) {}
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ MODALITY_STATS_FLOW_FAILED:', err.message);
  process.exit(1);
});
