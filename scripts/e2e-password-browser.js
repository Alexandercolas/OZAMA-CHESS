'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright');
const mongoose = require('mongoose');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_PASSWORD_E2E_PORT || 3257);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_pw' });
const serverLines = [];
const oldPassword = 'CorrectHorse99!';
const newPassword = 'NewCorrectHorse99!';

async function waitForServer(proc) {
  const deadline = Date.now() + 60000;
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

async function main() {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, ...isolatedMongo.env,
      PORT: String(port),
      JWT_SECRET: 'password-browser-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
      RECAPTCHA_SECRET_KEY: '', NODE_ENV: 'test',
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
    const context = await browser.newContext({ baseURL: baseUrl });
    const username = `password_${String(Date.now()).slice(-8)}`;
    const registered = await context.request.post('/api/auth/register', {
      data: { username, email: `${username}@example.test`, password: oldPassword, country: 'DO' },
    });
    const registration = await registered.json().catch(() => ({}));
    assert.equal(registered.status(), 201, JSON.stringify(registration));
    await context.addInitScript(({ origin, user }) => {
      if (location.origin === origin && !localStorage.getItem('e2e-session-seeded')) {
        localStorage.setItem('ozama-user', JSON.stringify(user));
        localStorage.setItem('e2e-session-seeded', '1');
      }
    }, { origin: baseUrl, user: registration.user });
    const page = await context.newPage();
    await page.goto('/settings.html');
    await page.locator('#change-password-form').waitFor({ state: 'attached' });
    await page.locator('.password-zone summary').click();
    await page.locator('#current-password').fill('WrongCurrent99!');
    await page.locator('#new-password').fill(newPassword);
    await page.locator('#confirm-password').fill(newPassword);
    await page.locator('#change-password-btn').click();
    await page.locator('#change-password-status').getByText('Contrasena actual incorrecta.').waitFor();
    assert.match(page.url(), /settings\.html/);
    console.log('Contraseña actual incorrecta: backend rechazó el cambio y mantuvo la sesión.');

    await page.locator('#current-password').fill(oldPassword);
    await page.locator('#change-password-btn').click();
    await page.waitForURL('**/login.html');
    assert.equal(await page.evaluate(() => localStorage.getItem('ozama-user')), null);
    const oldLogin = await context.request.post('/api/auth/login', {
      data: { identifier: username, password: oldPassword },
    });
    assert.equal(oldLogin.status(), 401, 'La clave anterior no debe autenticar');
    const newLogin = await context.request.post('/api/auth/login', {
      data: { identifier: username, password: newPassword },
    });
    assert.equal(newLogin.status(), 200, 'La clave nueva debe autenticar');
    console.log('Cambio confirmado: sesión cerrada, clave anterior rechazada y clave nueva aceptada.');

    const contextB = await browser.newContext({ baseURL: baseUrl });
    const contextC = await browser.newContext({ baseURL: baseUrl });
    const blockedUser = `blocked_${String(Date.now()).slice(-8)}`;
    const otherUser = `other_${String(Date.now()).slice(-8)}`;
    for (const [target, name] of [[contextB, blockedUser], [contextC, otherUser]]) {
      const response = await target.request.post('/api/auth/register', {
        data: { username: name, email: `${name}@example.test`, password: oldPassword, country: 'DO' },
      });
      assert.equal(response.status(), 201, `Register ${name}: ${await response.text()}`);
    }
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await contextB.request.put('/api/user/password', {
        headers: { Origin: baseUrl },
        data: { currentPassword: 'WrongCurrent99!', newPassword },
      });
      assert.equal(response.status(), 401, `Wrong password attempt ${attempt}`);
    }
    const blocked = await contextB.request.put('/api/user/password', {
      headers: { Origin: baseUrl },
      data: { currentPassword: oldPassword, newPassword },
    });
    assert.equal(blocked.status(), 429);
    assert.ok(Number(blocked.headers()['retry-after']) > 0);
    const unaffected = await contextC.request.put('/api/user/password', {
      headers: { Origin: baseUrl },
      data: { currentPassword: oldPassword, newPassword },
    });
    assert.equal(unaffected.status(), 200, 'Otra cuenta no debe quedar bloqueada');
    console.log('Límite por cuenta: intento 6 rechazado con 429; otra cuenta cambió su clave normalmente.');
    console.log('PASSWORD_BROWSER_FLOW_OK');
  } finally {
    await browser?.close();
    await stopServer(proc);
    if (databaseTouched) {
      assertSafeTestDatabase({
        uri: isolatedMongo.uri,
        dbName: isolatedMongo.dbName,
        productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME,
      });
      const connection = await mongoose.createConnection(isolatedMongo.uri, {
        dbName: isolatedMongo.dbName, serverSelectionTimeoutMS: 5000,
      }).asPromise();
      try { await connection.dropDatabase(); }
      finally { await connection.close(); }
      console.log('Base temporal de la prueba eliminada.');
    }
  }
}

main().catch((error) => {
  console.error('PASSWORD_BROWSER_FLOW_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
