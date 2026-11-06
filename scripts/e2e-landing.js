'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomInt } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = randomInt(35000, 50000);
const origin = `http://127.0.0.1:${port}`;
const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_landing' });
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
      JWT_SECRET: 'landing-test-secret-at-least-32-chars',
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
    const username = `landing_${String(Date.now()).slice(-8)}`;
    const password = 'CorrectHorse99!';
    const registration = await fetch(`${origin}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email: `${username}@example.test`, password, country: 'DO' }),
    });
    assert.equal(registration.status, 201, await registration.text());

    const context = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 700 }, locale: 'es-DO' });
    const page = await context.newPage();
    await page.goto('/');
    await page.locator('#cta-bot').waitFor();
    const mobile = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(mobile.content <= mobile.viewport + 1, `Mobile overflow: ${JSON.stringify(mobile)}`);
    assert.equal(await page.locator('.oz-install-card').count(), 0);
    await page.evaluate(() => scrollTo(0, 300));
    await page.locator('.oz-install-card').waitFor();
    await page.locator('.oz-install-close').click();
    await page.locator('#cta-bot').click();
    await page.waitForURL('**/login.html?next=bot');
    await page.locator('#login-identifier').fill(username);
    await page.locator('#login-password').fill(password);
    await page.locator('#btn-login').click();
    await page.waitForURL('**/lobby.html#bot');
    await page.locator('body:not(.auth-checking)').waitFor();
    await page.locator('#start-bot-btn').click();
    await page.waitForURL('**/game.html');
    await page.locator('body:not(.auth-checking)').waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ozama-bot-mode')), 'true');
    console.log(`BOT_FLOW_OK user=${username} mobile=${mobile.content}/${mobile.viewport}`);

    const guest = await browser.newContext({ baseURL: origin, locale: 'es-DO' });
    const damas = await guest.newPage();
    await damas.goto('/');
    await damas.locator('#cta-damas').click();
    await damas.waitForURL('**/damas.html');
    console.log('GUEST_DAMAS_FLOW_OK');
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

main().catch((error) => { console.error('LANDING_FLOW_FAILED:', error.stack || error.message); process.exitCode = 1; });
