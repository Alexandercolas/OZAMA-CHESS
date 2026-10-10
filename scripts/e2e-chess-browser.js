'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
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

async function checkMobileLayout(page, label, selector, extraSelectors = []) {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await page.evaluate((selectors) => {
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        targets: selectors.map((keySelector) => {
          const rect = document.querySelector(keySelector)?.getBoundingClientRect();
          return { selector: keySelector, rect: rect ? { left: rect.left, right: rect.right, width: rect.width } : null };
        }),
      };
    }, [selector, ...extraSelectors]);
    assert.ok(metrics.documentWidth <= metrics.viewport + 1, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
    for (const { selector: targetSelector, rect } of metrics.targets) {
      assert.ok(rect, `${label}: missing ${targetSelector}`);
      assert.ok(rect.width > 0 && rect.left >= -1 && rect.right <= metrics.viewport + 1,
        `${label}: control clipped ${JSON.stringify({ targetSelector, metrics })}`);
    }
    if (label === 'leaderboard') {
      const rows = await page.locator('.rank-row').evaluateAll((elements) => elements.map((row) => {
        const name = row.querySelector('.player-name-text')?.getBoundingClientRect();
        const elo = row.querySelector('.elo')?.getBoundingClientRect();
        return { nameRight: name?.right, eloLeft: elo?.left };
      }));
      assert.ok(rows.length > 0, 'leaderboard: ranking rows did not load');
      assert.ok(rows.every(({ nameRight, eloLeft }) => nameRight <= eloLeft - 1),
        `leaderboard: name overlaps ELO at ${width}px: ${JSON.stringify(rows)}`);
    }
    const screenshot = path.join(os.tmpdir(), `ozama-mobile-${label}-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    console.log(`Movil ${label}: ${metrics.viewport}px, contenido ${metrics.documentWidth}px, captura ${screenshot}`);
  }
}

async function waitForServer(proc) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${serverLines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/db`);
      if (response.ok && (await response.json()).database === 'connected') return;
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
    const versionResponse = await fetch(`${baseUrl}/api/app-version`, { cache: 'no-store' });
    assert.equal(versionResponse.status, 200);
    assert.match(versionResponse.headers.get('cache-control') || '', /no-store/);
    assert.ok((await versionResponse.json()).version);
    browser = await chromium.launch({ channel: chromeChannel, headless: true });
    const contextA = await browser.newContext({ baseURL: baseUrl });
    const contextB = await browser.newContext({ baseURL: baseUrl });
    const suffix = String(Date.now()).slice(-8);
    const userA = await register(contextA, `browserA_${suffix}`);
    const userB = await register(contextB, `browserB_${suffix}`);
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.setViewportSize({ width: 390, height: 844 });

    await Promise.all([pageA.goto('/lobby.html'), pageB.goto('/lobby.html')]);
    await Promise.all([
      pageA.locator('#hd-username').getByText(userA.username).waitFor(),
      pageB.locator('#hd-username').getByText(userB.username).waitFor(),
    ]);
    await checkMobileLayout(pageA, 'lobby', '#create-room-btn', ['#lang-switch', '#hd-avatar']);
    await pageA.goto('/profile.html');
    await pageA.locator('#main-content .profile-name').waitFor();
    await checkMobileLayout(pageA, 'profile', '.profile-tabs');
    await pageA.goto('/leaderboard.html');
    await pageA.waitForFunction(() => {
      const value = document.querySelector('#summary-players')?.textContent?.trim();
      return Boolean(value && value !== '--');
    });
    await checkMobileLayout(pageA, 'leaderboard', '.page');
    await pageA.goto('/lobby.html');
    await pageA.locator('#hd-username').getByText(userA.username).waitFor();
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
    await waitForPiece(pageA, 6, 5);
    await checkMobileLayout(pageA, 'game', '#board', ['#mobile-lobby-btn', '#hd-pro-btn']);
    await pageA.locator('#mobile-lobby-btn:visible').waitFor();
    pageA.once('dialog', (dialog) => dialog.dismiss());
    await pageA.locator('#mobile-lobby-btn').click();
    assert.match(pageA.url(), /game\.html/, 'Cancelar la salida conserva la partida');
    console.log(`Sala ${roomCode}: dos sesiones independientes entraron desde el lobby.`);

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
