'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = randomInt(35000, 50000);
const origin = `http://127.0.0.1:${port}`;
const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_sidebar' });
const lines = [];

async function waitReady(proc) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${lines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${origin}/api/health/db`);
      if (response.ok && (await response.json()).database === 'connected') return;
    } catch (_) {}
    await delay(500);
  }
  throw new Error(`Server not ready: ${lines.slice(-8).join('\n')}`);
}

async function main() {
  assertSafeTestDatabase({ uri: isolated.uri, dbName: isolated.dbName, productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME });
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, ...isolated.env, PORT: String(port), NODE_ENV: 'test',
      JWT_SECRET: 'sidebar-test-secret-at-least-32-chars',
      APP_ORIGINS: `${origin},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
      RECAPTCHA_SECRET_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on('data', (chunk) => lines.push(...chunk.toString().trim().split(/\r?\n/)));
  }

  let browser;
  let connection;
  try {
    await waitReady(proc);
    connection = await mongoose.createConnection(isolated.uri, { dbName: isolated.dbName }).asPromise();
    browser = await chromium.launch({ channel: process.env.OZAMA_E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true });
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
    const username = `sidebar_${String(Date.now()).slice(-8)}`;
    const response = await context.request.post('/api/auth/register', {
      data: { username, email: `${username}@example.test`, password: 'CorrectHorse99!', country: 'DO' },
    });
    const auth = await response.json();
    assert.equal(response.status(), 201, JSON.stringify(auth));
    await context.addInitScript(({ baseUrl, user }) => {
      if (location.origin === baseUrl) localStorage.setItem('ozama-user', JSON.stringify(user));
    }, { baseUrl: origin, user: auth.user });
    const page = await context.newPage();
    const openLobby = async () => {
      await page.goto('/lobby.html');
      await page.locator('body:not(.auth-checking)').waitFor();
    };
    await openLobby();

    for (const [section, control] of [
      ['jugar', 'quick-time-control'],
      ['salas', 'create-username-input'],
      ['desafios', 'challenge-username'],
    ]) {
      const link = page.locator(`.sb-item[data-lobby-section="${section}"]`);
      await link.click();
      assert.equal(new URL(page.url()).hash, `#${section}`);
      assert.match(await link.getAttribute('class'), /\bon\b/);
      assert.equal(await link.getAttribute('aria-current'), 'location');
      assert.equal(await page.evaluate(() => document.activeElement?.id), control);
      await link.click();
      assert.equal(await page.evaluate(() => document.activeElement?.id), control, `Repeated click: ${section}`);
    }
    await page.goBack();
    assert.equal(new URL(page.url()).hash, '#salas');
    assert.match(await page.locator('[data-lobby-section="salas"]').getAttribute('class'), /\bon\b/);
    console.log('SECTIONS=jugar,salas,desafios; REPEATED_CLICKS=ok; BACK=ok');

    for (const destination of [
      'damas', 'tournaments', 'training', 'openings', 'dashboard', 'profile',
      'history', 'collection', 'leaderboard', 'settings',
    ]) {
      await openLobby();
      await page.locator(`.sb-item[href="/${destination}.html"]`).click();
      await page.waitForURL(`**/${destination}.html`);
      assert.equal(new URL(page.url()).pathname, `/${destination}.html`);
    }
    console.log('DESTINATIONS=damas,tournaments,training,openings,dashboard,profile,history,collection,leaderboard,settings');

    await openLobby();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-lobby-section="salas"]').click();
    const mobileWidth = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(mobileWidth.content <= mobileWidth.viewport + 1, `Mobile overflow: ${JSON.stringify(mobileWidth)}`);
    const screenshot = path.join(os.tmpdir(), 'ozama-sidebar-mobile.png');
    await page.screenshot({ path: screenshot });
    await page.selectOption('#bot-difficulty', 'hard');
    await page.locator('#sidebar-bot-btn').click();
    await page.waitForURL('**/game.html');
    assert.deepEqual(await page.evaluate(() => ({
      bot: sessionStorage.getItem('ozama-bot-mode'),
      difficulty: sessionStorage.getItem('ozama-bot-difficulty'),
    })), { bot: 'true', difficulty: 'hard' });
    console.log(`BOT=game.html,difficulty=hard; MOBILE_WIDTH=${mobileWidth.content}/${mobileWidth.viewport}; SCREENSHOT=${screenshot}`);

    await openLobby();
    await page.locator('#logout-sb').click();
    await page.waitForURL('**/login.html');
    console.log('LOGOUT=login.html; LOBBY_SIDEBAR_FLOW_OK');
  } finally {
    await browser?.close();
    if (proc.exitCode === null) {
      const exited = new Promise((resolve) => proc.once('exit', resolve));
      proc.kill('SIGTERM');
      await Promise.race([exited, delay(8000)]);
      if (proc.exitCode === null) { proc.kill('SIGKILL'); await exited; }
    }
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
      console.log('TEST_DB_DROPPED=true');
    }
  }
}

main().catch((error) => { console.error('LOBBY_SIDEBAR_FLOW_FAILED:', error.stack || error.message); process.exitCode = 1; });
