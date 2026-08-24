'use strict';

require('dotenv').config();

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DYNAMIC_TEST_PORT || 3137);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_dynamic_security' });
const mongoUri = isolatedMongo.uri;
const testDbName = isolatedMongo.dbName;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(proc, lines) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}`);
    try {
      const res = await fetch(`${baseUrl}/api/health/db`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {}
    await wait(500);
  }
  throw new Error(`server did not become ready. logs:\n${lines.join('\n')}`);
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') || '' };
}

function connectSocket(token, label) {
  const socket = io(baseUrl, {
    auth: { token },
    reconnection: false,
    timeout: 5_000,
  });
  socket.on('connect_error', (err) => {
    console.log(`[${label}] connect_error: ${err.message}`);
  });
  return socket;
}

function connectSocketCookie(cookie, label) {
  const socket = io(baseUrl, {
    auth: {},
    extraHeaders: { Cookie: cookie },
    reconnection: false,
    timeout: 5_000,
  });
  socket.on('connect_error', (err) => {
    console.log(`[${label}] connect_error: ${err.message}`);
  });
  return socket;
}

function waitEvent(socket, event, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off(event, onEvent);
    }
    function onEvent(payload) {
      cleanup();
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

function waitEither(socket, events, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${events.join(' or ')}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      for (const [event, listener] of listeners) socket.off(event, listener);
    }
    const listeners = events.map((event) => {
      const listener = (payload) => {
        cleanup();
        resolve({ event, payload });
      };
      socket.on(event, listener);
      return [event, listener];
    });
  });
}

async function register(username) {
  const res = await postJson('/api/auth/register', {
    username,
    email: `${username.toLowerCase()}@example.test`,
    password: 'CorrectHorse99!',
    country: 'DO',
  });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { ...res.data, sessionCookie: res.setCookie.split(';')[0], rawSetCookie: res.setCookie };
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'dynamic-security-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) serverLines.push(...text.split(/\r?\n/));
  });
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) serverLines.push(...text.split(/\r?\n/));
  });

  const sockets = [];
  try {
    await waitForServer(proc, serverLines);
    console.log(`DYNAMIC_DB=${testDbName}`);

    const providersResponse = await fetch(`${baseUrl}/api/auth/providers`, { cache: 'no-store' });
    const providers = await providersResponse.json();
    if (providersResponse.status !== 200
      || providers.google?.enabled !== false
      || providers.google?.clientId !== '') {
      throw new Error(`disabled provider config leaked or changed: ${JSON.stringify(providers)}`);
    }
    console.log('GOOGLE_PROVIDER_DISABLED_SAFE=true');

    const disabledGoogle = await postJson('/api/auth/google', { idToken: 'not-a-token' });
    if (disabledGoogle.status !== 503) {
      throw new Error(`disabled Google endpoint returned ${disabledGoogle.status}`);
    }
    console.log('GOOGLE_DISABLED_ENDPOINT_STATUS=503');

    const suffix = String(Date.now()).slice(-8);
    const userA = await register(`secA_${suffix}`);
    const userB = await register(`secB_${suffix}`);
    console.log(`REGISTER_A=${userA.user.username}`);
    console.log(`REGISTER_B=${userB.user.username}`);
    if (!/HttpOnly/i.test(userA.rawSetCookie) || !/SameSite=Lax/i.test(userA.rawSetCookie)) {
      throw new Error('session cookie is missing HttpOnly or SameSite=Lax');
    }

    const cookieProfile = await fetch(`${baseUrl}/api/user/me`, {
      headers: { Cookie: userA.sessionCookie },
    });
    console.log(`COOKIE_PROFILE_STATUS=${cookieProfile.status}`);
    if (cookieProfile.status !== 200) throw new Error(`cookie profile failed with ${cookieProfile.status}`);

    const csrfBlocked = await fetch(`${baseUrl}/api/user/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userA.sessionCookie,
        Origin: 'https://attacker.example',
      },
      body: JSON.stringify({ country: 'DO' }),
    });
    console.log(`COOKIE_CSRF_BLOCKED_STATUS=${csrfBlocked.status}`);
    if (csrfBlocked.status !== 403) throw new Error(`cross-origin cookie write was not blocked: ${csrfBlocked.status}`);

    const csrfAllowed = await fetch(`${baseUrl}/api/user/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: userA.sessionCookie,
        Origin: baseUrl,
      },
      body: JSON.stringify({ country: 'DO' }),
    });
    console.log(`COOKIE_SAME_ORIGIN_STATUS=${csrfAllowed.status}`);
    if (csrfAllowed.status !== 200) throw new Error(`same-origin cookie write failed: ${csrfAllowed.status}`);

    const cookieSocket = connectSocketCookie(userA.sessionCookie, 'COOKIE');
    sockets.push(cookieSocket);
    await once(cookieSocket, 'connect');
    console.log('COOKIE_SOCKET_CONNECTED=true');
    cookieSocket.disconnect();

    const malicious = await postJson('/api/auth/register', {
      username: '<img src=x onerror=alert(1)>',
      email: `xss_${suffix}@example.test`,
      password: 'CorrectHorse99!',
      country: 'DO',
    });
    console.log(`XSS_REGISTER_STATUS=${malicious.status}`);
    console.log(`XSS_REGISTER_ERROR=${malicious.data.error || ''}`);

    const socketA = connectSocket(userA.token, 'A');
    const socketB = connectSocket(userB.token, 'B');
    sockets.push(socketA, socketB);
    await Promise.all([once(socketA, 'connect'), once(socketB, 'connect')]);

    socketA.emit('create-room', {});
    const created = await waitEvent(socketA, 'room-created');
    console.log(`ROOM_CREATED=${created.code}`);
    console.log(`A_ROOM_TOKEN_PREFIX=${String(created.roomToken).slice(0, 8)}...`);

    socketB.emit('rejoin', {
      roomCode: created.code,
      color: 'w',
      token: '0'.repeat(48),
    });
    const failed = await waitEvent(socketB, 'rejoin-failed');
    console.log(`ATTACK_REJOIN_FAILED=${failed}`);
    socketB.emit('player-move', {
      room: created.code,
      from: { row: 6, col: 4 },
      to: { row: 4, col: 4 },
    });
    const attackMoveRejected = await waitEvent(socketB, 'move-rejected');
    console.log(`ATTACK_MOVE_REJECTED=${attackMoveRejected.message}`);

    socketB.emit('rejoin', {
      roomCode: created.code,
      color: 'w',
      token: created.roomToken,
    });
    const stolenTokenFailed = await waitEvent(socketB, 'rejoin-failed');
    console.log(`STOLEN_ROOM_TOKEN_REJECTED=${stolenTokenFailed}`);

    const socketAClone = connectSocket(userA.token, 'A_CLONE');
    sockets.push(socketAClone);
    await once(socketAClone, 'connect');
    socketAClone.emit('join-room', { code: created.code });
    const ownRoomRejected = await waitEvent(socketAClone, 'room-error');
    console.log(`SAME_ACCOUNT_SECOND_COLOR_REJECTED=${ownRoomRejected}`);

    const startA = waitEvent(socketA, 'game-start');
    const startB = waitEvent(socketB, 'game-start');
    socketB.emit('join-room', { code: created.code });
    const [gameA, gameB] = await Promise.all([startA, startB]);
    if (gameA.color !== 'w' || gameB.color !== 'b') {
      throw new Error(`incorrect colors assigned: A=${gameA.color} B=${gameB.color}`);
    }
    console.log(`GAME_COLORS=A:${gameA.color},B:${gameB.color}`);

    socketB.emit('player-move', {
      room: created.code,
      from: { row: 1, col: 4 },
      to: { row: 3, col: 4 },
    });
    const blackOutOfTurn = await waitEvent(socketB, 'move-rejected');
    console.log(`BLACK_OUT_OF_TURN_REJECTED=${blackOutOfTurn.message}`);

    const whiteMoveSeen = waitEvent(socketB, 'opponent-move');
    socketA.emit('player-move', {
      room: created.code,
      from: { row: 6, col: 4 },
      to: { row: 4, col: 4 },
    });
    const whiteMove = await whiteMoveSeen;
    if (whiteMove.from.row !== 6 || whiteMove.to.row !== 4 || whiteMove.to.col !== 4) {
      throw new Error(`unexpected white move payload: ${JSON.stringify(whiteMove)}`);
    }
    console.log('WHITE_MOVE_ACCEPTED=e2-e4');

    socketA.emit('player-move', {
      room: created.code,
      from: { row: 6, col: 3 },
      to: { row: 4, col: 3 },
    });
    const whiteSecondMove = await waitEvent(socketA, 'move-rejected');
    console.log(`WHITE_SECOND_MOVE_REJECTED=${whiteSecondMove.message}`);

    const blackMoveSeen = waitEvent(socketA, 'opponent-move');
    socketB.emit('player-move', {
      room: created.code,
      from: { row: 1, col: 4 },
      to: { row: 3, col: 4 },
    });
    const blackMove = await blackMoveSeen;
    if (blackMove.from.row !== 1 || blackMove.to.row !== 3 || blackMove.to.col !== 4) {
      throw new Error(`unexpected black move payload: ${JSON.stringify(blackMove)}`);
    }
    console.log('BLACK_MOVE_ACCEPTED=e7-e5');

    socketA.disconnect();
    await wait(300);
    const socketA2 = connectSocket(userA.token, 'A2');
    sockets.push(socketA2);
    await once(socketA2, 'connect');
    socketA2.emit('rejoin', {
      roomCode: created.code,
      color: 'w',
      token: created.roomToken,
    });
    const ok = await waitEvent(socketA2, 'rejoin-ok');
    console.log(`LEGIT_REJOIN_OK_COLOR=${ok.color}`);
    console.log(`LEGIT_REJOIN_ROOM_TOKEN_MATCH=${ok.roomToken === created.roomToken}`);
    const restoredWhitePawn = ok.game?.board?.[4]?.[4];
    const restoredBlackPawn = ok.game?.board?.[3]?.[4];
    if (ok.currentTurn !== 'w'
      || restoredWhitePawn?.type !== 'p' || restoredWhitePawn?.color !== 'w'
      || restoredBlackPawn?.type !== 'p' || restoredBlackPawn?.color !== 'b') {
      throw new Error(`rejoin did not preserve board/turn: ${JSON.stringify({
        currentTurn: ok.currentTurn,
        restoredWhitePawn,
        restoredBlackPawn,
      })}`);
    }
    console.log('REJOIN_BOARD_PRESERVED=e2-e4,e7-e5');

    const userC = await register(`secC_${suffix}`);
    const userD = await register(`secD_${suffix}`);
    const socketC = connectSocket(userC.token, 'C');
    const socketD = connectSocket(userD.token, 'D');
    sockets.push(socketC, socketD);
    await Promise.all([once(socketC, 'connect'), once(socketD, 'connect')]);

    let cCreated = 0;
    let cRejected = 0;
    for (let i = 1; i <= 30; i += 1) {
      const outcome = new Promise((resolve) => {
        const done = (kind, payload) => {
          socketC.off('room-created', onCreated);
          socketC.off('room-error', onError);
          resolve({ kind, payload });
        };
        const onCreated = (payload) => done('created', payload);
        const onError = (payload) => done('rejected', payload);
        socketC.once('room-created', onCreated);
        socketC.once('room-error', onError);
      });
      socketC.emit('create-room', {});
      const result = await outcome;
      if (result.kind === 'created') {
        cCreated += 1;
        console.log(`C_ATTEMPT_${i}=created:${result.payload.code}`);
      } else {
        cRejected += 1;
        console.log(`C_ATTEMPT_${i}=rejected:${result.payload}`);
      }
    }
    console.log(`RATE_LIMIT_C_CREATED=${cCreated}`);
    console.log(`RATE_LIMIT_C_REJECTED=${cRejected}`);

    socketD.emit('create-room', {});
    const dCreated = await waitEvent(socketD, 'room-created');
    console.log(`OTHER_SOCKET_CREATED=${dCreated.code}`);

    const rejoinSecurityLogs = serverLines.filter((line) => line.includes('[SECURITY] Rejoin rejected'));
    rejoinSecurityLogs.forEach((line) => console.log(`SERVER_LOG=${line}`));
  } finally {
    for (const socket of sockets) socket.disconnect();
    proc.kill();
    await wait(500);
    await mongoose.connect(mongoUri, { dbName: testDbName });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`DYNAMIC_DB_DROPPED=${testDbName}`);
  }
}

main().catch((err) => {
  console.error(`DYNAMIC_SECURITY_CHECK_FAILED=${err.message}`);
  process.exitCode = 1;
});
