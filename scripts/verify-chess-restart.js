'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_RESTART_TEST_PORT || randomInt(35000, 50000));
const origin = `http://127.0.0.1:${port}`;
const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_restart' });
const lines = [];

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, ...isolated.env, PORT: String(port),
      JWT_SECRET: 'chess-restart-test-secret-at-least-32-chars',
      APP_ORIGINS: `${origin},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
      RECAPTCHA_SECRET_KEY: '', NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => lines.push(...chunk.toString().trim().split(/\r?\n/)));
  }
  return child;
}

async function waitReady(child) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${lines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${origin}/api/health/db`);
      if (response.ok && (await response.json()).database === 'connected'
        && lines.some((line) => line.includes('OZAMA CHESS - Servidor corriendo'))) return;
    } catch (_) {}
    await delay(500);
  }
  throw new Error(`Server not ready: ${lines.slice(-8).join('\n')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send({ type: 'ozama:test-shutdown' });
  await Promise.race([exited, delay(9000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
    throw new Error(`Server did not shut down gracefully: ${lines.slice(-8).join('\n')}`);
  }
  assert.equal(child.exitCode, 0, `Shutdown failed: ${lines.join('\n')}`);
}

function event(socket, name) {
  return Promise.race([
    once(socket, name).then(([payload]) => payload),
    delay(8000).then(() => { throw new Error(`Timed out waiting for ${name}`); }),
  ]);
}

async function register(name) {
  const response = await fetch(`${origin}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: `${name.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO' }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.token;
}

async function connect(token, sockets) {
  const socket = io(origin, { auth: { token }, reconnection: false, timeout: 5000 });
  sockets.push(socket);
  await event(socket, 'connect');
  return socket;
}

async function main() {
  assertSafeTestDatabase({ uri: isolated.uri, dbName: isolated.dbName, productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME });
  let child = startServer();
  const sockets = [];
  let connection;
  let ready = false;
  try {
    console.log(`TEST_PORT=${port}; TEST_DB=${isolated.dbName}`);
    await waitReady(child);
    ready = true;
    connection = await mongoose.createConnection(isolated.uri, { dbName: isolated.dbName }).asPromise();
    const suffix = String(Date.now()).slice(-8);
    const [whiteToken, blackToken] = await Promise.all([register(`restartW_${suffix}`), register(`restartB_${suffix}`)]);
    const white = await connect(whiteToken, sockets);
    const black = await connect(blackToken, sockets);
    const createdEvent = event(white, 'room-created');
    white.emit('create-room', { timeControl: '3+0' });
    const created = await createdEvent;
    const whiteStart = event(white, 'game-start');
    const blackStart = event(black, 'game-start');
    black.emit('join-room', { code: created.code });
    await whiteStart;
    const blackGame = await blackStart;
    const seenMove = event(black, 'opponent-move');
    white.emit('player-move', { room: created.code, from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
    await seenMove;
    await delay(2400);
    await stopServer(child);
    console.log('SHUTDOWN=graceful');

    const saved = await connection.db.collection('rooms').findOne({ roomCode: created.code });
    assert.equal(saved.status, 'playing');
    assert.ok(saved.clockB < 180000, `Black clock was not saved: ${saved.clockB}`);
    console.log(`SAVED_CLOCK_B=${saved.clockB}`);

    child = startServer();
    ready = false;
    await waitReady(child);
    ready = true;
    const whiteAgain = await connect(whiteToken, sockets);
    const blackAgain = await connect(blackToken, sockets);
    const whiteRejoined = event(whiteAgain, 'rejoin-ok');
    whiteAgain.emit('rejoin', { roomCode: created.code, color: 'w', token: created.roomToken });
    const whiteState = await whiteRejoined;
    assert.equal(whiteState.game.board[4][4].type, 'p');
    assert.equal(whiteState.currentTurn, 'b');
    assert.equal(whiteState.clockB, saved.clockB);
    console.log(`WHITE_REJOIN=ok; TURN=${whiteState.currentTurn}; CLOCK_B=${whiteState.clockB}`);

    const blackRejoined = event(blackAgain, 'rejoin-ok');
    blackAgain.emit('rejoin', { roomCode: created.code, color: 'b', token: blackGame.roomToken });
    const blackState = await blackRejoined;
    assert.equal(blackState.game.board[4][4].type, 'p');
    const nextMove = event(whiteAgain, 'opponent-move');
    blackAgain.emit('player-move', { room: created.code, from: { row: 1, col: 4 }, to: { row: 3, col: 4 } });
    const accepted = await nextMove;
    assert.equal(accepted.to.row, 3);
    console.log('BLACK_REJOIN=ok; NEXT_MOVE=e7-e5 accepted');
    console.log(`RESTART_RECOVERY=PASS; ROOM=${created.code}`);
  } catch (err) {
    console.error(`TEST_FAILURE=${err.message}`);
    throw err;
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (child?.exitCode === null) {
      if (ready) await stopServer(child);
      else child.kill('SIGKILL');
    }
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
