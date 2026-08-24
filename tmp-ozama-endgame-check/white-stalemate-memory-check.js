/* eslint-disable no-console */
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('../scripts/test-db-guard');
const Match = require('../models/Match');

const port = 3157;
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_dynamic_endgame' });

process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
process.env.PORT = String(port);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'white-stalemate-test-secret-at-least-32';
process.env.APP_ORIGINS = `${baseUrl},http://localhost:${port}`;
process.env.NODE_ENV = 'test';

const capturedMaps = [];
const RealMap = global.Map;
function CapturedMap(...args) {
  const map = new RealMap(...args);
  capturedMaps.push(map);
  return map;
}
CapturedMap.prototype = RealMap.prototype;
Object.setPrototypeOf(CapturedMap, RealMap);
global.Map = CapturedMap;
require('../server');
global.Map = RealMap;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health/db`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {}
    await wait(400);
  }
  throw new Error('server did not become ready');
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function register(username) {
  const res = await postJson('/api/auth/register', {
    username,
    email: `${username.toLowerCase()}@example.test`,
    password: 'CorrectHorse99!',
    country: 'DO',
  });
  if (res.status !== 201) throw new Error(`register ${username}: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

function connectSocket(token) {
  return io(baseUrl, { auth: { token }, reconnection: false, timeout: 5_000 });
}

function waitEvent(socket, event, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (payload) => {
      cleanup();
      resolve(payload);
    };
    function cleanup() {
      clearTimeout(timer);
      socket.off(event, onEvent);
    }
    socket.on(event, onEvent);
  });
}

function waitAny(sockets, events, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const listeners = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${events.join(' or ')}`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      for (const { socket, event, listener } of listeners) socket.off(event, listener);
    }
    for (const socket of sockets) {
      for (const event of events) {
        const listener = (payload) => {
          cleanup();
          resolve({ event, payload });
        };
        listeners.push({ socket, event, listener });
        socket.on(event, listener);
      }
    }
  });
}

function emptyBoard() {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));
}

async function main() {
  await waitForServer();
  await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
  console.log(`WHITE_STALEMATE_DB=${isolatedMongo.dbName}`);

  const suffix = `${Date.now()}`.slice(-7);
  const whiteUser = await register(`egW_stale_${suffix}`.slice(0, 20));
  const blackUser = await register(`egB_stale_${suffix}`.slice(0, 20));
  const white = connectSocket(whiteUser.token);
  const black = connectSocket(blackUser.token);
  await Promise.all([waitEvent(white, 'connect'), waitEvent(black, 'connect')]);

  white.emit('create-room', {});
  const created = await waitEvent(white, 'room-created');
  black.emit('join-room', { code: created.code });
  await Promise.all([waitEvent(white, 'game-start'), waitEvent(black, 'game-start')]);

  const rooms = capturedMaps.find((map) => map.get(created.code)?.game);
  if (!rooms) throw new Error('could not capture rooms map');
  const room = rooms.get(created.code);
  const board = emptyBoard();
  board[7][7] = { type: 'k', color: 'w' }; // White king h1.
  board[6][5] = { type: 'k', color: 'b' }; // Black king f2.
  board[4][6] = { type: 'q', color: 'b' }; // Black queen g4, one move before stalemate.
  room.game = {
    board,
    turn: 'b',
    castlingRights: { w: { kingside: false, queenside: false }, b: { kingside: false, queenside: false } },
    enPassantTarget: null,
    halfMoveClock: 0,
    moveCount: 0,
    lastMove: null,
  };
  room.currentTurn = 'b';

  const final = waitAny([white, black], ['game-finished', 'move-rejected'], 8_000);
  black.emit('player-move', {
    room: created.code,
    from: { row: 4, col: 6 },
    to: { row: 5, col: 6 },
    promotion: null,
  });
  const event = await final;
  if (event.event === 'move-rejected') throw new Error(`final move rejected: ${JSON.stringify(event.payload)}`);
  await wait(500);
  const match = await Match.findOne({ roomCode: created.code }).select('result winner endedAt moves').lean();
  const passed = event.payload.result === 'draw'
    && (event.payload.winner || null) === null
    && match?.result === 'draw'
    && (match?.winner || null) === null
    && !!match?.endedAt;
  console.log(JSON.stringify({
    case: 'stalemate_white',
    room: created.code,
    finalMove: 'Qg4-g3=',
    event: event.payload,
    match: {
      result: match?.result,
      winner: match?.winner || null,
      endedAt: !!match?.endedAt,
      moves: match?.moves?.length,
    },
    passed,
  }));
  if (!passed) throw new Error('stalemate_white did not finish as expected');

  white.disconnect();
  black.disconnect();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`WHITE_STALEMATE_DB_DROPPED=${isolatedMongo.dbName}`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`WHITE_STALEMATE_CHECK_FAILED=${err.stack || err.message}`);
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  } catch (_) {}
  process.exit(1);
});
