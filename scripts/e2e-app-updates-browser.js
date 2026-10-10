'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');

async function openPage(browser, baseUrl, route, viewport) {
  const context = await browser.newContext({ baseURL: baseUrl, viewport });
  const page = await context.newPage();
  const firstCheck = page.waitForResponse((response) => response.url().endsWith('/api/app-version') && response.ok());
  await page.goto(route);
  await firstCheck;
  await page.waitForTimeout(100);
  return { context, page };
}

async function checkAgain(page) {
  const response = page.waitForResponse((result) => result.url().endsWith('/api/app-version') && result.ok());
  await page.evaluate(() => window.dispatchEvent(new Event('ozama:resume')));
  await response;
}

async function main() {
  let version = 'test-v1';
  const app = express();
  app.get('/api/app-version', (_req, res) => res.set('Cache-Control', 'no-store').json({ version }));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.OZAMA_E2E_BROWSER || 'chrome', headless: true });

    const login = await openPage(browser, baseUrl, '/login.html', { width: 320, height: 700 });
    version = 'test-v2';
    await checkAgain(login.page);
    await login.page.locator('.oz-update-notice .oz-update-action').waitFor();
    const noticeBounds = await login.page.locator('.oz-update-notice').boundingBox();
    assert.ok(noticeBounds.x >= 0 && noticeBounds.x + noticeBounds.width <= 321);
    await login.page.screenshot({ path: path.join(os.tmpdir(), 'ozama-update-notice-mobile.png') });
    assert.match(login.page.url(), /login\.html/);
    await login.page.locator('.oz-update-close').click();
    await checkAgain(login.page);
    assert.equal(await login.page.locator('.oz-update-notice').count(), 0);
    version = 'test-v3';
    await checkAgain(login.page);
    await login.page.locator('.oz-update-action').click();
    await login.page.waitForLoadState('load');
    assert.equal(await login.page.locator('.oz-update-notice').count(), 0);
    console.log('Formulario: aviso, posponer sin repeticion y actualizar al elegirlo.');
    await login.context.close();

    version = 'test-v1';
    const ranking = await openPage(browser, baseUrl, '/leaderboard.html');
    version = 'test-v2';
    const reload = ranking.page.waitForEvent('framenavigated', (frame) => frame === ranking.page.mainFrame());
    await checkAgain(ranking.page);
    await reload;
    assert.match(ranking.page.url(), /leaderboard\.html/);
    console.log('Pagina publica: nueva version aplicada con recarga automatica.');
    await ranking.context.close();

    version = 'test-v1';
    const damas = await openPage(browser, baseUrl, '/damas.html');
    await damas.page.locator('#board .square').first().waitFor();
    version = 'test-v2';
    await checkAgain(damas.page);
    assert.equal(await damas.page.locator('.oz-update-notice').count(), 0);
    assert.match(damas.page.url(), /damas\.html/);
    console.log('Partida: nueva version detectada sin recargar ni tapar el tablero.');
    await damas.context.close();

    console.log('APP_UPDATES_BROWSER_FLOW_OK');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('APP_UPDATES_BROWSER_FLOW_FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
