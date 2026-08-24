/* eslint-disable no-console */
'use strict';

require('dotenv').config();

const { spawn } = require('node:child_process');
const { once } = require('node:events');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('../scripts/test-db-guard');
const Match = require('../models/Match');

const port = 3147;
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_dynamic_endgame' });

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
    await wait(400);
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

function connectSocket(token, label) {
  const socket = io(baseUrl, { auth: { token }, reconnection: false, timeout: 5_000 });
  socket.on('connect_error', (err) => console.log(`[${label}] connect_error=${err.message}`));
  return socket;
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

async function createOnlineGame(label) {
  const suffix = `${Date.now()}`.slice(-7);
  const whiteUser = await register(`egW_${label}_${suffix}`.slice(0, 20));
  const blackUser = await register(`egB_${label}_${suffix}`.slice(0, 20));
  const white = connectSocket(whiteUser.token, `${label}-w`);
  const black = connectSocket(blackUser.token, `${label}-b`);
  await Promise.all([once(white, 'connect'), once(black, 'connect')]);

  white.emit('create-room', {});
  const created = await waitEvent(white, 'room-created');
  black.emit('join-room', { code: created.code });
  await Promise.all([waitEvent(white, 'game-start'), waitEvent(black, 'game-start')]);
  return { white, black, code: created.code };
}

async function playMove(game, move) {
  const socket = move.by === 'w' ? game.white : game.black;
  const opponent = move.by === 'w' ? game.black : game.white;
  const outcome = waitAny([socket, opponent], ['opponent-move', 'game-finished', 'move-rejected'], 8_000);
  socket.emit('player-move', {
    room: game.code,
    from: { row: move.from[0], col: move.from[1] },
    to: { row: move.to[0], col: move.to[1] },
    promotion: move.promotion || null,
  });
  const result = await outcome;
  if (result.event === 'move-rejected') throw new Error(`${move.name} rejected: ${JSON.stringify(result.payload)}`);
  return result;
}

async function runCase(label, moves, expected) {
  const game = await createOnlineGame(label);
  const sockets = [game.white, game.black];
  let finalEvent = null;
  try {
    for (const move of moves) {
      const event = await playMove(game, move);
      console.log(`${label}: ${move.name} -> ${event.event}`);
      if (event.event === 'game-finished') {
        finalEvent = event.payload;
        break;
      }
    }
    if (!finalEvent) finalEvent = await waitAny(sockets, ['game-finished'], 8_000).then((event) => event.payload);
    await wait(500);
    const match = await Match.findOne({ roomCode: game.code }).select('result winner endedAt moves').lean();
    const passed = finalEvent.result === expected.result
      && (finalEvent.winner || null) === (expected.winner || null)
      && match?.result === expected.result
      && (match?.winner || null) === (expected.winner || null)
      && !!match?.endedAt;
    console.log(JSON.stringify({
      case: label,
      room: game.code,
      event: finalEvent,
      match: {
        result: match?.result,
        winner: match?.winner || null,
        endedAt: !!match?.endedAt,
        moves: match?.moves?.length,
      },
      passed,
    }));
    if (!passed) throw new Error(`${label} did not finish as expected`);
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
}

const M = {
  e2e4: { by: 'w', from: [6, 4], to: [4, 4], name: 'e2-e4' },
  e7e5: { by: 'b', from: [1, 4], to: [3, 4], name: 'e7-e5' },
  Bf1c4: { by: 'w', from: [7, 5], to: [4, 2], name: 'Bf1-c4' },
  Nb8c6: { by: 'b', from: [0, 1], to: [2, 2], name: 'Nb8-c6' },
  Qd1h5: { by: 'w', from: [7, 3], to: [3, 7], name: 'Qd1-h5' },
  Ng8f6: { by: 'b', from: [0, 6], to: [2, 5], name: 'Ng8-f6' },
  Qh5f7: { by: 'w', from: [3, 7], to: [1, 5], name: 'Qh5xf7#' },

  f2f3: { by: 'w', from: [6, 5], to: [5, 5], name: 'f2-f3' },
  g2g4: { by: 'w', from: [6, 6], to: [4, 6], name: 'g2-g4' },
  Qd8h4: { by: 'b', from: [0, 3], to: [4, 7], name: 'Qd8-h4#' },

  e2e3: { by: 'w', from: [6, 4], to: [5, 4], name: 'e2-e3' },
  a7a5: { by: 'b', from: [1, 0], to: [3, 0], name: 'a7-a5' },
  Ra8a6: { by: 'b', from: [0, 0], to: [2, 0], name: 'Ra8-a6' },
  Qh5a5: { by: 'w', from: [3, 7], to: [3, 0], name: 'Qh5xa5' },
  h7h5: { by: 'b', from: [1, 7], to: [3, 7], name: 'h7-h5' },
  Qa5c7: { by: 'w', from: [3, 0], to: [1, 2], name: 'Qa5xc7' },
  Ra6h6: { by: 'b', from: [2, 0], to: [2, 7], name: 'Ra6-h6' },
  h2h4: { by: 'w', from: [6, 7], to: [4, 7], name: 'h2-h4' },
  f7f6: { by: 'b', from: [1, 5], to: [2, 5], name: 'f7-f6' },
  Qc7d7: { by: 'w', from: [1, 2], to: [1, 3], name: 'Qc7xd7+' },
  Ke8f7: { by: 'b', from: [0, 4], to: [1, 5], name: 'Ke8-f7' },
  Qd7b7: { by: 'w', from: [1, 3], to: [1, 1], name: 'Qd7xb7' },
  Qd8d3: { by: 'b', from: [0, 3], to: [5, 3], name: 'Qd8-d3' },
  Qb7b8: { by: 'w', from: [1, 1], to: [0, 1], name: 'Qb7xb8' },
  Qd3h7: { by: 'b', from: [5, 3], to: [1, 7], name: 'Qd3-h7' },
  Qb8c8: { by: 'w', from: [0, 1], to: [0, 2], name: 'Qb8xc8' },
  Kf7g6: { by: 'b', from: [1, 5], to: [2, 6], name: 'Kf7-g6' },
  Qc8e6: { by: 'w', from: [0, 2], to: [2, 4], name: 'Qc8-e6=' },
};

async function main() {
  const lines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...isolatedMongo.env,
      PORT: String(port),
      JWT_SECRET: process.env.JWT_SECRET || 'endgame-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) lines.push(...text.split(/\r?\n/));
  });
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) lines.push(...text.split(/\r?\n/));
  });

  try {
    await waitForServer(proc, lines);
    await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
    console.log(`ENDGAME_DB=${isolatedMongo.dbName}`);
    await runCase('mate_black', [M.e2e4, M.e7e5, M.Bf1c4, M.Nb8c6, M.Qd1h5, M.Ng8f6, M.Qh5f7], { result: 'white_win', winner: 'w' });
    await runCase('mate_white', [M.f2f3, M.e7e5, M.g2g4, M.Qd8h4], { result: 'black_win', winner: 'b' });
    await runCase('stalemate_black', [M.e2e3, M.a7a5, M.Qd1h5, M.Ra8a6, M.Qh5a5, M.h7h5, M.Qa5c7, M.Ra6h6, M.h2h4, M.f7f6, M.Qc7d7, M.Ke8f7, M.Qd7b7, M.Qd8d3, M.Qb7b8, M.Qd3h7, M.Qb8c8, M.Kf7g6, M.Qc8e6], { result: 'draw', winner: null });
    lines.filter((line) => line.includes('finalizada por servidor')).forEach((line) => console.log(`SERVER_LOG=${line}`));
  } finally {
    proc.kill();
    await wait(500);
    if (mongoose.connection.readyState !== 1) await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`ENDGAME_DB_DROPPED=${isolatedMongo.dbName}`);
  }
}

main().catch((err) => {
  console.error(`ENDGAME_CHECK_FAILED=${err.stack || err.message}`);
  process.exitCode = 1;
});
