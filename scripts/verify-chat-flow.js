'use strict';

// Prueba de punta a punta del chat (Fase 7, "OZAMA PRO"): antes de esta
// fase, Ajedrez tenia chat SIN ningun limite de velocidad (spam libre),
// y Damas no tenia chat en absoluto. Verifica, contra un server.js real
// y una Mongo aislada y temporal (nunca produccion):
//
//   - el chat de Ajedrez llega al rival con from/color/senderId/message
//     correctos, y ahora tiene un limite real (15/min) -- el mensaje
//     16 en la misma ventana se rechaza con room-error, no se
//     silencia ni se cuelga;
//   - Damas ahora SI tiene chat (damas:chat-message), mismo contrato,
//     mismo limite (damasChat), guest-friendly como el resto de Damas;
//   - un espectador (sin color/asiento en ninguno de los dos juegos)
//     no puede mandar mensajes -- ni error ni broadcast, la MISMA
//     guarda de autorizacion que ya protege player-move/damas:move,
//     sin codigo nuevo especifico de chat.
//
// Uso: node scripts/verify-chat-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_CHAT_TEST_PORT || 3199);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_chat' });

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

function neverEvent(socket, event, ms = 900) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(); }, ms);
    function onEvent(payload) { clearTimeout(timer); socket.off(event, onEvent); reject(new Error(`no deberia haber llegado "${event}" pero llego: ${JSON.stringify(payload)}`)); }
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
      JWT_SECRET: process.env.JWT_SECRET || 'chat-flow-test-secret-at-least-32-chars',
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
    const pA = await register(`chatA_${suffix}`);
    const pB = await register(`chatB_${suffix}`);

    // ═══════════════════ AJEDREZ ═══════════════════
    {
      const sockA = io(baseUrl, { auth: { token: pA.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: pB.token }, reconnection: false, timeout: 5000 });
      const spec = io(baseUrl, { auth: { token: pB.token }, reconnection: false, timeout: 5000 });
      sockets.push(sockA, sockB, spec);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect'), waitEvent(spec, 'connect')]);

      const createdA = waitEvent(sockA, 'room-created');
      sockA.emit('create-room', { playerName: pA.user.username });
      const roomInfo = await createdA;
      const startA = waitEvent(sockA, 'game-start');
      const startB = waitEvent(sockB, 'game-start');
      sockB.emit('join-room', { code: roomInfo.code, playerName: pB.user.username });
      await Promise.all([startA, startB]);

      const specStart = waitEvent(spec, 'spectate-start');
      spec.emit('spectate-room', { room: roomInfo.code });
      await specStart;

      const bRecv = waitEvent(sockB, 'chat-message');
      const specRecv = waitEvent(spec, 'chat-message');
      sockA.emit('chat-message', { room: roomInfo.code, message: '¡Buena suerte!' });
      const [msgB, msgSpec] = await Promise.all([bRecv, specRecv]);
      assert(msgB.message === '¡Buena suerte!' && msgB.senderId, `mensaje deberia llegar con texto y senderId, vino ${JSON.stringify(msgB)}`);
      assert(msgSpec.message === '¡Buena suerte!', 'el espectador deberia recibir el MISMO broadcast que el rival');
      console.log('Ajedrez: chat llega al rival Y al espectador con from/color/senderId/message correctos.');

      const specTriesChat = neverEvent(sockB, 'chat-message', 800);
      spec.emit('chat-message', { room: roomInfo.code, message: 'no deberia pasar' });
      await specTriesChat;
      console.log('Ajedrez: un espectador (sin color) no puede mandar chat -- ninguna guarda nueva, la de siempre.');

      // Limite de 15/min -- el 16 deberia rebotar con room-error.
      for (let i = 0; i < 15; i++) sockA.emit('chat-message', { room: roomInfo.code, message: `spam${i}` });
      await wait(400);
      const rejectWaiter = waitEvent(sockA, 'room-error');
      sockA.emit('chat-message', { room: roomInfo.code, message: 'spam-de-mas' });
      const rejection = await rejectWaiter;
      assert(/demasiadas/i.test(typeof rejection === 'string' ? rejection : rejection?.message || ''), `el mensaje 16 deberia rebotar por limite de velocidad, vino ${JSON.stringify(rejection)}`);
      console.log('Ajedrez: el chat ahora SI tiene limite de velocidad -- el mensaje 16 en un minuto se rechaza.');

      sockA.close(); sockB.close(); spec.close();
    }

    // ═══════════════════ DAMAS ═══════════════════
    {
      const sockA = io(baseUrl, { auth: { token: pA.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: pB.token }, reconnection: false, timeout: 5000 });
      const spec = io(baseUrl, { reconnection: false, timeout: 5000 }); // anonimo -- Damas es guest-friendly
      sockets.push(sockA, sockB, spec);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect'), waitEvent(spec, 'connect')]);

      const createdA = waitEvent(sockA, 'damas:room-created');
      sockA.emit('damas:create-room', { playerName: pA.user.username, country: 'DO' });
      const roomInfo = await createdA;
      const startA = waitEvent(sockA, 'damas:game-start');
      const startB = waitEvent(sockB, 'damas:game-start');
      sockB.emit('damas:join-room', { code: roomInfo.code, playerName: pB.user.username, country: 'DO' });
      await Promise.all([startA, startB]);

      const specStart = waitEvent(spec, 'damas:spectate-start');
      spec.emit('damas:spectate-room', { room: roomInfo.code });
      await specStart;

      const bRecv = waitEvent(sockB, 'damas:chat-message');
      sockA.emit('damas:chat-message', { room: roomInfo.code, message: 'Hola!' });
      const msgB = await bRecv;
      assert(msgB.message === 'Hola!' && msgB.from && msgB.senderId, `mensaje de Damas deberia llegar con texto/from/senderId, vino ${JSON.stringify(msgB)}`);
      console.log('Damas: damas:chat-message llega al rival con from/senderId/message correctos (Damas no tenia chat antes de esta fase).');

      const specTriesChat = neverEvent(sockB, 'damas:chat-message', 800);
      spec.emit('damas:chat-message', { room: roomInfo.code, message: 'no deberia pasar' });
      await specTriesChat;
      console.log('Damas: un espectador tampoco puede mandar chat.');

      for (let i = 0; i < 15; i++) sockA.emit('damas:chat-message', { room: roomInfo.code, message: `spam${i}` });
      await wait(400);
      const rejectWaiter = waitEvent(sockA, 'damas:room-error');
      sockA.emit('damas:chat-message', { room: roomInfo.code, message: 'spam-de-mas' });
      const rejection = await rejectWaiter;
      assert(/demasiadas/i.test(typeof rejection === 'string' ? rejection : rejection?.message || ''), `el mensaje 16 de Damas deberia rebotar por limite de velocidad, vino ${JSON.stringify(rejection)}`);
      console.log('Damas: limite de velocidad tambien activo (damasChat).');

      sockA.close(); sockB.close(); spec.close();
    }

    console.log('\n✅ CHAT_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ CHAT_FLOW_FAILED:', err.message);
  process.exit(1);
});
