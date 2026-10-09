'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const Match = require('../models/Match');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_BROWSER_E2E_PORT || 3255);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_browser' });
const chromeChannel = process.env.OZAMA_E2E_BROWSER || 'chrome';
const serverLines = [];

function square(page, row, col) {
  return page.locator(`#board .square[data-row="${row}"][data-col="${col}"]`);
}

async function waitForPiece(page, row, col) {
  await square(page, row, col).locator('.piece').waitFor({ state: 'visible', timeout: 10000 });
}

async function move(page, from, to, opponent) {
  await square(page, ...from).click();
  await square(page, ...to).click();
  await waitForPiece(opponent, ...to);
  await square(opponent, ...from).locator('.piece').waitFor({ state: 'detached', timeout: 10000 });
}

async function waitForServer(proc) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${serverLines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/db`);
      if (response.ok) return;
    } catch (_) {}
    await delay(400);
  }
  throw new Error(`Server not ready: ${serverLines.slice(-8).join('\n')}`);
}

async function register(context, username) {
  const response = await context.request.post(`${baseUrl}/api/auth/register`, {
    data: { username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO' },
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status(), 201, `Register ${username}: ${JSON.stringify(data)}`);
  await context.addInitScript(({ origin, user }) => {
    if (location.origin === origin && !localStorage.getItem('ozama-user')) {
      localStorage.setItem('ozama-user', JSON.stringify(user));
    }
  }, { origin: baseUrl, user: data.user });
  return data.user;
}

async function stopServer(proc) {
  if (proc.exitCode !== null) return;
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (proc.exitCode === null) {
    proc.kill('SIGKILL');
    await exited;
  }
}

async function dropTestDatabase() {
  assertSafeTestDatabase({
    uri: isolatedMongo.uri,
    dbName: isolatedMongo.dbName,
    productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME,
  });
  const connection = await mongoose.createConnection(isolatedMongo.uri, {
    dbName: isolatedMongo.dbName,
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
  try {
    await connection.dropDatabase();
  } finally {
    await connection.close();
  }
}

async function main() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...isolatedMongo.env,
      PORT: String(port),
      JWT_SECRET: 'browser-flow-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
      RECAPTCHA_SECRET_KEY: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (chunk) => serverLines.push(...chunk.toString().trim().split(/\r?\n/)));
  proc.stderr.on('data', (chunk) => serverLines.push(...chunk.toString().trim().split(/\r?\n/)));

  let browser;
  let databaseTouched = false;
  try {
    await waitForServer(proc);
    databaseTouched = true;
    browser = await chromium.launch({ channel: chromeChannel, headless: true });
    const contextA = await browser.newContext({ baseURL: baseUrl });
    const contextB = await browser.newContext({ baseURL: baseUrl });
    const suffix = String(Date.now()).slice(-8);
    const userA = await register(contextA, `browserA_${suffix}`);
    const userB = await register(contextB, `browserB_${suffix}`);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto('/lobby.html'), pageB.goto('/lobby.html')]);
    await Promise.all([
      pageA.locator('#hd-username').getByText(userA.username).waitFor(),
      pageB.locator('#hd-username').getByText(userB.username).waitFor(),
    ]);
    await pageA.locator('#create-time-control').selectOption('3+0');
    await pageA.locator('#create-room-btn').click();
    await pageA.locator('#room-code-display.show').waitFor();
    const roomCode = (await pageA.locator('#room-code-value').textContent()).trim();
    assert.match(roomCode, /^[A-Z0-9]{6}$/);
    await pageB.locator('#room-code-input').fill(roomCode);
    await pageB.locator('#join-room-btn').click();
    await Promise.all([pageA.waitForURL('**/game.html'), pageB.waitForURL('**/game.html')]);
    assert.equal(await pageA.evaluate(() => sessionStorage.getItem('ozama-color')), 'w');
    assert.equal(await pageB.evaluate(() => sessionStorage.getItem('ozama-color')), 'b');
    console.log(`Sala ${roomCode}: dos sesiones independientes entraron desde el lobby.`);

    await waitForPiece(pageA, 6, 5);
    await waitForPiece(pageB, 1, 4);
    await move(pageA, [6, 5], [5, 5], pageB); // f3
    await move(pageB, [1, 4], [3, 4], pageA); // ...e5

    await pageA.reload();
    await waitForPiece(pageA, 5, 5);
    await waitForPiece(pageA, 3, 4);
    assert.equal(await pageA.evaluate(() => sessionStorage.getItem('ozama-room')), roomCode);
    console.log('Recarga de blancas: tablero restaurado y asiento conservado.');

    await move(pageA, [6, 6], [4, 6], pageB); // g4
    await move(pageB, [0, 3], [4, 7], pageA); // ...Qh4#
    await Promise.all([
      pageA.locator('#game-over-overlay:not(.hidden)').waitFor(),
      pageB.locator('#game-over-overlay:not(.hidden)').waitFor(),
    ]);
    assert.match(await pageA.locator('#game-over-title').textContent(), /DERROTA|JAQUE MATE/i);
    assert.match(await pageB.locator('#game-over-title').textContent(), /JAQUE MATE/i);

    const connection = await mongoose.createConnection(isolatedMongo.uri, {
      dbName: isolatedMongo.dbName,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    try {
      const match = await connection.model('Match', Match.schema).findOne({ roomCode }).lean();
      assert.ok(match, 'Match must exist in MongoDB');
      assert.equal(match.result, 'black_win');
      assert.equal(match.moves.length, 4);
    } finally {
      await connection.close();
    }
    console.log('Mate visible en ambos navegadores; Match black_win y 4 jugadas en Mongo.');
    console.log('CHESS_BROWSER_FLOW_OK');
  } finally {
    await browser?.close();
    await stopServer(proc);
    if (databaseTouched) {
      await dropTestDatabase();
      console.log('Base temporal de la prueba eliminada.');
    }
  }
}

main().catch((error) => {
  console.error('CHESS_BROWSER_FLOW_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
