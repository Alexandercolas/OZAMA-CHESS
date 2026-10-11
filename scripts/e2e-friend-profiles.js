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
const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_friends' });
const serverLines = [];

async function waitReady(proc) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (proc.exitCode !== null) throw new Error(`Server exited: ${serverLines.slice(-8).join('\n')}`);
    try {
      const response = await fetch(`${origin}/api/health/db`);
      if (response.ok && (await response.json()).database === 'connected') return;
    } catch (_) {}
    await delay(500);
  }
  throw new Error(`Server not ready: ${serverLines.slice(-8).join('\n')}`);
}

async function register(context, username) {
  const response = await context.request.post(`${origin}/api/auth/register`, {
    data: { username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO' },
  });
  const data = await response.json();
  assert.equal(response.status(), 201, `Register ${username}: ${JSON.stringify(data)}`);
  await context.addInitScript(({ baseUrl, user }) => {
    if (location.origin === baseUrl) localStorage.setItem('ozama-user', JSON.stringify(user));
  }, { baseUrl: origin, user: data.user });
  return data.user;
}

async function main() {
  assertSafeTestDatabase({ uri: isolated.uri, dbName: isolated.dbName, productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME });
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, ...isolated.env, PORT: String(port), NODE_ENV: 'test',
      JWT_SECRET: 'friend-profile-test-secret-at-least-32-chars',
      APP_ORIGINS: `${origin},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '', GOOGLE_ANDROID_CLIENT_ID: '', GOOGLE_CLIENT_IDS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.on('data', (chunk) => serverLines.push(...chunk.toString().trim().split(/\r?\n/)));
  }

  let browser;
  let connection;
  try {
    await waitReady(proc);
    connection = await mongoose.createConnection(isolated.uri, { dbName: isolated.dbName }).asPromise();
    browser = await chromium.launch({ channel: process.env.OZAMA_E2E_BROWSER === 'chromium' ? undefined : 'chrome', headless: true });
    const ownerContext = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 800 } });
    const friendContext = await browser.newContext({ baseURL: origin });
    const visitorContext = await browser.newContext({ baseURL: origin });
    const suffix = String(Date.now()).slice(-8);
    const owner = await register(ownerContext, `friendA_${suffix}`);
    const friend = await register(friendContext, `friendB_${suffix}`);
    await connection.db.collection('users').updateOne({ username: friend.username }, { $set: {
      bio: 'Juego ajedrez y damas', elo: 1350, damasElo: 1270,
      'stats.wins': 3, 'stats.losses': 2, 'stats.draws': 1,
      'damasStats.wins': 1, 'damasStats.losses': 0, 'damasStats.draws': 1,
    } });
    const add = await ownerContext.request.post(`/api/user/friends/${friend.username}`, {
      headers: { Origin: origin },
    });
    assert.equal(add.status(), 200);

    const listResponse = await ownerContext.request.get('/api/user/friends');
    const list = await listResponse.json();
    assert.equal(list.friends.length, 1);
    assert.equal(list.friends[0].damasElo, 1270);
    assert.deepEqual(Object.keys(list.friends[0]).sort(),
      ['username', 'country', 'avatar', 'avatarImage', 'elo', 'damasElo', 'stats'].sort());
    for (const key of ['email', 'password', 'lastSeenAt', 'authProviders', '_id']) {
      assert.equal(Object.hasOwn(list.friends[0], key), false, `Private friend field: ${key}`);
    }

    const publicResponse = await visitorContext.request.get(`/api/user/${friend.username}`);
    const publicData = await publicResponse.json();
    assert.equal(publicResponse.status(), 200);
    assert.equal(publicData.viewerUsername, null);
    assert.equal(publicData.user.elo, 1350);
    assert.equal(publicData.user.damasStats.wins, 1);
    assert.deepEqual(Object.keys(publicData.user).sort(), [
      'username', 'country', 'avatar', 'avatarImage', 'bio', 'elo', 'damasElo',
      'stats', 'damasStats', 'createdAt', 'equippedFrame', 'premiumActive',
      'rank', 'damasRank', 'level', 'globalTitle', 'achievementsUnlocked', 'badges',
    ].sort());
    for (const key of ['email', 'password', 'authProviders', 'friends', 'blockedUsers', 'plan', 'premiumUntil', 'xp', 'isActive', '_id']) {
      assert.equal(Object.hasOwn(publicData.user, key), false, `Private public-profile field: ${key}`);
    }

    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto('/profile.html');
    const friendRow = ownerPage.locator('.friend-row', { hasText: friend.username });
    await friendRow.waitFor();
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    const listWidth = await ownerPage.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(listWidth.content <= listWidth.viewport + 1, `Friends list mobile overflow: ${JSON.stringify(listWidth)}`);
    const listScreenshot = path.join(os.tmpdir(), 'ozama-friends-list-mobile.png');
    await ownerPage.screenshot({ path: listScreenshot, fullPage: true });
    await ownerPage.setViewportSize({ width: 320, height: 700 });
    const narrowListWidth = await ownerPage.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(narrowListWidth.content <= narrowListWidth.viewport + 1, `Friends list 320px overflow: ${JSON.stringify(narrowListWidth)}`);
    await ownerPage.setViewportSize({ width: 1280, height: 800 });
    await friendRow.getByRole('link', { name: 'Ver perfil', exact: true }).click();
    await ownerPage.waitForURL(`**/player.html?u=${friend.username}`);
    await ownerPage.getByRole('heading', { name: friend.username }).waitFor();
    assert.equal(await ownerPage.locator('.friend-status').textContent(), 'Amigo');
    assert.equal(await ownerPage.locator('.stat-chip').first().locator('.v').textContent(), '3');
    await ownerPage.getByRole('button', { name: 'Damas' }).click();
    assert.equal(await ownerPage.locator('.stat-chip').first().locator('.v').textContent(), '1');
    assert.equal(await ownerPage.getByRole('link', { name: 'Nuestras partidas' }).getAttribute('href'), `/history.html?opponent=${friend.username}`);
    const desktopScreenshot = path.join(os.tmpdir(), 'ozama-friend-profile-desktop.png');
    await ownerPage.screenshot({ path: desktopScreenshot, fullPage: true });
    await ownerPage.setViewportSize({ width: 390, height: 844 });
    const width = await ownerPage.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(width.content <= width.viewport + 1, `Mobile overflow: ${JSON.stringify(width)}`);
    const mobileScreenshot = path.join(os.tmpdir(), 'ozama-friend-profile-mobile.png');
    await ownerPage.screenshot({ path: mobileScreenshot, fullPage: true });
    await ownerPage.setViewportSize({ width: 320, height: 700 });
    const narrowWidth = await ownerPage.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(narrowWidth.content <= narrowWidth.viewport + 1, `Profile 320px overflow: ${JSON.stringify(narrowWidth)}`);
    await ownerPage.getByRole('button', { name: 'Quitar amigo' }).click();
    await ownerPage.getByRole('button', { name: 'Agregar amigo' }).waitFor();
    assert.equal(await ownerPage.locator('.friend-status').count(), 0);
    await ownerPage.getByRole('button', { name: 'Agregar amigo' }).click();
    await ownerPage.getByRole('button', { name: 'Quitar amigo' }).waitFor();
    assert.equal(await ownerPage.locator('.friend-status').textContent(), 'Amigo');

    const visitorPage = await visitorContext.newPage();
    await visitorPage.goto(`/player.html?u=${friend.username}`);
    await visitorPage.getByRole('heading', { name: friend.username }).waitFor();
    assert.equal(await visitorPage.getByRole('button', { name: 'Agregar amigo' }).count(), 0);
    assert.equal(await visitorPage.getByRole('link', { name: 'Iniciar sesion para desafiar' }).count(), 1);
    console.log(`FRIEND_PROFILE_FLOW_OK owner=${owner.username} friend=${friend.username}`);
    console.log(`PUBLIC_FIELDS_SAFE=true; MOBILE_WIDTH=${width.content}/${width.viewport}`);
    console.log(`SCREENSHOTS=${listScreenshot}; ${desktopScreenshot}; ${mobileScreenshot}`);
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

main().catch((error) => { console.error('FRIEND_PROFILE_FLOW_FAILED:', error.stack || error.message); process.exitCode = 1; });
