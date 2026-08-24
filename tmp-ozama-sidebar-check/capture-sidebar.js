const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: 'test-user',
  exp: Math.floor(Date.now() / 1000) + 3600,
})}.sig`;

const root = path.join(process.cwd(), 'public');
const out = path.join(process.cwd(), 'tmp-ozama-sidebar-check');
const user = { _id: 'test-user', username: 'Tester', elo: 1420, country: 'DO' };
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serve(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/api/user/me') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ user }));
    return;
  }

  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.createReadStream(file)
    .on('error', () => {
      res.writeHead(404);
      res.end('Not found');
    })
    .once('open', () => {
      res.writeHead(200, {
        'content-type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      });
    })
    .pipe(res);
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer(serve);
  await new Promise((resolve) => server.listen(4179, '127.0.0.1', resolve));

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ({ token, user }) => {
      localStorage.setItem('ozama-token', token);
      localStorage.setItem('ozama-user', JSON.stringify(user));
    },
    { token, user },
  );

  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4179/lobby.html', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(900);

  const sidebar = await page.locator('.sb').boundingBox();
  const bot = page.locator('.sb-item[href="/lobby.html#bot"]');

  async function screenshot(name, locator) {
    const box = await locator.boundingBox();
    await page.screenshot({
      path: path.join(out, name),
      clip: {
        x: Math.max(0, box.x - 8),
        y: Math.max(0, box.y - 8),
        width: box.width + 16,
        height: box.height + 16,
      },
    });
  }

  await page.screenshot({
    path: path.join(out, 'sidebar-complete.png'),
    clip: { x: sidebar.x, y: sidebar.y, width: sidebar.width, height: sidebar.height },
  });
  await screenshot('bot-inactive.png', bot);
  await bot.hover();
  await page.waitForTimeout(250);
  await screenshot('bot-hover.png', bot);
  await page.evaluate(() => {
    document.querySelectorAll('.sb-item.on').forEach((el) => el.classList.remove('on'));
    document.querySelector('.sb-item[href="/lobby.html#bot"]')?.classList.add('on');
  });
  await page.waitForTimeout(250);
  await screenshot('bot-active.png', bot);

  const metrics = await page.evaluate(() => ({
    hasHeaderSalir: !!document.getElementById('logout-btn'),
    hasSidebarLogout: !!document.getElementById('logout-sb'),
    accountLabel: [...document.querySelectorAll('.sb-account-label')].map((el) => el.textContent.trim()),
    logoutIconColor: getComputedStyle(document.querySelector('#logout-sb .sb-icon')).color,
    sidebarBorderImage: getComputedStyle(document.querySelector('.sb')).borderImageSource,
  }));

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ out, metrics }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
