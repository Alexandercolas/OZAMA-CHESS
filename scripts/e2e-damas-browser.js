'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const DamasMatch = require('../models/DamasMatch');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DAMAS_E2E_PORT || 3256);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_damas_browser' });
const serverLines = [];

function square(page, row, col) {
  return page.locator('#board .square').nth(row * 8 + col);
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

async function withTestDatabase(callback) {
  assertSafeTestDatabase({ uri: isolatedMongo.uri, dbName: isolatedMongo.dbName, productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME });
  const connection = await mongoose.createConnection(isolatedMongo.uri, {
    dbName: isolatedMongo.dbName,
    serverSelectionTimeoutMS: 5000,
  }).asPromise();
  try {
    return await callback(connection);
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
      JWT_SECRET: 'damas-browser-test-secret-at-least-32-chars',
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
    browser = await chromium.launch({ channel: process.env.OZAMA_E2E_BROWSER || 'chrome', headless: true });
    const contextA = await browser.newContext({ baseURL: baseUrl });
    const contextB = await browser.newContext({ baseURL: baseUrl });
    const suffix = String(Date.now()).slice(-8);
    const userA = await register(contextA, `damasA_${suffix}`);
    const userB = await register(contextB, `damasB_${suffix}`);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto('/damas.html'), pageB.goto('/damas.html')]);
    await Promise.all([pageA.locator('#mode-online').click(), pageB.locator('#mode-online').click()]);
    await pageA.getByRole('button', { name: 'Crear sala' }).click();
    await pageA.locator('#online-waiting:not(.hidden)').waitFor();
    const roomCode = (await pageA.locator('#room-code-display').textContent()).trim();
    assert.match(roomCode, /^[A-Z0-9]{6}$/);
    await pageB.locator('#join-code-input').fill(roomCode);
    await pageB.getByRole('button', { name: 'Unirse' }).click();
    await Promise.all([
      pageA.locator('#board-wrap:not(.hidden)').waitFor(),
      pageB.locator('#board-wrap:not(.hidden)').waitFor(),
    ]);
    assert.deepEqual(await pageA.evaluate(() => {
      const { code, color } = JSON.parse(sessionStorage.getItem('ozama-damas-online-session'));
      return { code, color };
    }), { code: roomCode, color: 'w' });
    assert.deepEqual(await pageB.evaluate(() => {
      const { code, color } = JSON.parse(sessionStorage.getItem('ozama-damas-online-session'));
      return { code, color };
    }), { code: roomCode, color: 'b' });
    console.log(`Sala ${roomCode}: ${userA.username} (blancas) y ${userB.username} (negras) conectados.`);

    await square(pageA, 5, 0).locator('.piece.w').waitFor();
    await square(pageA, 5, 0).click();
    await square(pageA, 4, 1).click();
    await square(pageA, 4, 1).locator('.piece.w').waitFor();
    await square(pageA, 5, 0).locator('.piece').waitFor({ state: 'detached' });
    await pageB.locator('#turn-text').getByText('Turno: Negras').waitFor();

    await pageA.reload();
    await pageA.locator('#board-wrap:not(.hidden)').waitFor();
    await square(pageA, 4, 1).locator('.piece.w').waitFor();
    await square(pageA, 5, 0).locator('.piece').waitFor({ state: 'detached' });
    assert.equal(JSON.parse(await pageA.evaluate(() => sessionStorage.getItem('ozama-damas-online-session'))).code, roomCode);
    console.log('Movimiento recibido y recarga de blancas: tablero y asiento recuperados.');

    await pageB.locator('#resign-btn').click();
    await pageB.locator('#damas-confirm-overlay:not(.hidden)').waitFor();
    await pageB.locator('#damas-confirm-accept-btn').click();
    await Promise.all([
      pageA.locator('#gameover-overlay:not(.hidden)').waitFor(),
      pageB.locator('#gameover-overlay:not(.hidden)').waitFor(),
    ]);
    assert.equal((await pageA.locator('#gameover-title').textContent()).trim(), 'GANASTE');
    assert.equal((await pageB.locator('#gameover-title').textContent()).trim(), 'PERDISTE');

    await withTestDatabase(async (connection) => {
      const Match = connection.model('DamasMatch', DamasMatch.schema);
      let match;
      for (let attempt = 0; attempt < 20 && !match; attempt++) {
        match = await Match.findOne({ roomCode }).lean();
        if (!match) await delay(250);
      }
      assert.ok(match, 'DamasMatch must exist in MongoDB');
      assert.equal(match.result, 'white_win');
      assert.equal(match.winner, 'w');
      assert.equal(match.reason, 'resign');
      assert.equal(match.whitePlayer.name, userA.username);
      assert.equal(match.blackPlayer.name, userB.username);
    });
    console.log('Fin visible en ambos navegadores; DamasMatch white_win/resign confirmado en Mongo.');
    console.log('DAMAS_BROWSER_FLOW_OK');
  } finally {
    await browser?.close();
    await stopServer(proc);
    if (databaseTouched) {
      await withTestDatabase((connection) => connection.dropDatabase());
      console.log('Base temporal de la prueba eliminada.');
    }
  }
}

main().catch((error) => {
  console.error('DAMAS_BROWSER_FLOW_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
