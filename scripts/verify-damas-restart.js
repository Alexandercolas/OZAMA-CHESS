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

const port = Number(process.env.OZAMA_DAMAS_RESTART_PORT || randomInt(35000, 50000));
const origin = `http://127.0.0.1:${port}`;
const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_damas_restart' });
const serverLines = [];

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, ...isolated.env, PORT: String(port),
      JWT_SECRET: 'damas-restart-test-secret-at-least-32-chars',
      APP_ORIGINS: `${origin},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
      RECAPTCHA_SECRET_KEY: '', NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => serverLines.push(...chunk.toString().trim().split(/\r?\n/)));
  }
  return child;
}

async function waitReady(child, fromLine) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${serverLines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${origin}/api/health/db`);
      if (response.ok && (await response.json()).database === 'connected'
        && serverLines.slice(fromLine).some((line) => line.includes('OZAMA CHESS - Servidor corriendo'))) return;
    } catch (_) {}
    await delay(500);
  }
  throw new Error(`Server not ready: ${serverLines.slice(-8).join('\n')}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.send({ type: 'ozama:test-shutdown' });
  await Promise.race([exited, delay(9000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
    throw new Error(`Server did not shut down: ${serverLines.slice(-8).join('\n')}`);
  }
  assert.equal(child.exitCode, 0, `Shutdown failed: ${serverLines.slice(-8).join('\n')}`);
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
  const socket = io(origin, { auth: token ? { token } : {}, reconnection: false, timeout: 5000 });
  sockets.push(socket);
  await event(socket, 'connect');
  return socket;
}

async function createGame(white, black) {
  const createdEvent = event(white, 'damas:room-created');
  white.emit('damas:create-room', { timeControl: '3+0' });
  const created = await createdEvent;
  const whiteStart = event(white, 'damas:game-start');
  const blackStart = event(black, 'damas:game-start');
  black.emit('damas:join-room', { code: created.code });
  await whiteStart;
  const blackGame = await blackStart;
  const moved = event(black, 'damas:board-update');
  white.emit('damas:move', {
    room: created.code, fromR: 5, fromC: 0,
    seq: [{ toR: 4, toC: 1, capturedR: -1, capturedC: -1 }],
  });
  const update = await moved;
  assert.equal(update.board[4][1].color, 'w');
  return { code: created.code, whiteToken: created.roomToken, blackToken: blackGame.roomToken };
}

async function rejoin(socket, game, color, token) {
  const started = event(socket, 'damas:game-start');
  socket.emit('damas:rejoin', { room: game.code, color, token });
  return started;
}

async function main() {
  assertSafeTestDatabase({ uri: isolated.uri, dbName: isolated.dbName, productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME });
  let fromLine = serverLines.length;
  let child = startServer();
  let ready = false;
  let connection;
  const sockets = [];
  try {
    console.log(`TEST_DB=${isolated.dbName}; PORT=${port}`);
    await waitReady(child, fromLine);
    ready = true;
    connection = await mongoose.createConnection(isolated.uri, { dbName: isolated.dbName }).asPromise();
    const suffix = String(Date.now()).slice(-8);
    const [whiteAuth, blackAuth] = await Promise.all([register(`restartDW_${suffix}`), register(`restartDB_${suffix}`)]);
    const white = await connect(whiteAuth, sockets);
    const black = await connect(blackAuth, sockets);
    const guestWhite = await connect(null, sockets);
    const guestBlack = await connect(null, sockets);
    const accountGame = await createGame(white, black);
    const guestGame = await createGame(guestWhite, guestBlack);
    await delay(2200);
    await stopServer(child);
    ready = false;
    console.log('SHUTDOWN=graceful; ACTIVE_ROOMS=2');

    const collection = connection.db.collection('damasrooms');
    const savedAccount = await collection.findOne({ roomCode: accountGame.code });
    const savedGuest = await collection.findOne({ roomCode: guestGame.code });
    for (const saved of [savedAccount, savedGuest]) {
      assert.equal(saved.status, 'playing');
      assert.equal(saved.board[4][1].color, 'w');
      assert.equal(saved.turn, 'b');
      assert.ok(saved.clockB < 180000, `Clock not saved: ${saved.clockB}`);
      assert.equal(saved.noProgressPlies, 1);
    }
    console.log(`SAVED_CLOCKS=${savedAccount.clockB},${savedGuest.clockB}; BOARD=white 4,1; TURN=b`);

    fromLine = serverLines.length;
    child = startServer();
    await waitReady(child, fromLine);
    ready = true;

    const attacker = await connect(blackAuth, sockets);
    const badToken = event(attacker, 'damas:rejoin-failed');
    attacker.emit('damas:rejoin', { room: accountGame.code, color: 'w', token: '0'.repeat(48) });
    await badToken;
    const wrongAccount = event(attacker, 'damas:rejoin-failed');
    attacker.emit('damas:rejoin', { room: accountGame.code, color: 'w', token: accountGame.whiteToken });
    await wrongAccount;
    console.log('ATTACKS=bad_token_rejected,wrong_account_rejected');

    const whiteAgain = await connect(whiteAuth, sockets);
    const blackAgain = await connect(blackAuth, sockets);
    const guestWhiteAgain = await connect(null, sockets);
    const guestBlackAgain = await connect(null, sockets);
    const accountWhiteState = await rejoin(whiteAgain, accountGame, 'w', accountGame.whiteToken);
    const guestWhiteState = await rejoin(guestWhiteAgain, guestGame, 'w', guestGame.whiteToken);
    assert.equal(accountWhiteState.clockB, savedAccount.clockB);
    assert.equal(guestWhiteState.clockB, savedGuest.clockB);
    await Promise.all([
      rejoin(blackAgain, accountGame, 'b', accountGame.blackToken),
      rejoin(guestBlackAgain, guestGame, 'b', guestGame.blackToken),
    ]);
    console.log('REJOIN=accounts_and_guests_ok');

    const nextMove = event(whiteAgain, 'damas:board-update');
    blackAgain.emit('damas:move', {
      room: accountGame.code, fromR: 2, fromC: 1,
      seq: [{ toR: 3, toC: 0, capturedR: -1, capturedC: -1 }],
    });
    const update = await nextMove;
    assert.equal(update.board[3][0].color, 'b');
    const savedNext = await collection.findOne({ roomCode: accountGame.code });
    assert.equal(savedNext.turn, 'w');
    assert.equal(savedNext.noProgressPlies, 2);
    console.log('NEXT_MOVE=black 2,1 to 3,0; PERSISTED=true');

    const over = event(whiteAgain, 'damas:game-over');
    blackAgain.emit('damas:resign', { room: accountGame.code });
    assert.equal((await over).reason, 'resign');
    for (let attempt = 0; attempt < 20; attempt++) {
      const saved = await collection.findOne({ roomCode: accountGame.code });
      const match = await connection.db.collection('damasmatches').findOne({ roomCode: accountGame.code });
      if (saved?.status === 'finished' && match?.result === 'white_win') break;
      if (attempt === 19) throw new Error('Finished room or DamasMatch was not persisted');
      await delay(250);
    }
    console.log('FINISH=room_closed_and_match_saved');
    console.log('DAMAS_RESTART_RECOVERY=PASS');
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
      console.log('TEST_DB_DROPPED=true');
    }
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
