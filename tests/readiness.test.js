'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('PWA manifest exposes installable application assets', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.name, 'OZAMA CHESS');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('service worker never handles private API or Socket.IO traffic', () => {
  const worker = read('public/service-worker.js');
  assert.match(worker, /authorization/i);
  assert.match(worker, /startsWith\('\/api\/'\)/);
  assert.match(worker, /startsWith\('\/socket\.io\/'\)/);

  const precache = worker.slice(worker.indexOf('const PRECACHE'), worker.indexOf('];', worker.indexOf('const PRECACHE')));
  for (const privatePage of ['lobby.html', 'game.html', 'profile.html', 'admin.html']) {
    assert.doesNotMatch(precache, new RegExp(privatePage));
  }
});

test('public and private pages publish the intended index policy', () => {
  for (const page of ['index.html', 'leaderboard.html', 'privacy.html', 'support.html']) {
    const html = read(`public/${page}`);
    assert.match(html, /<meta name="robots" content="index, follow/);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  }

  for (const page of ['login.html', 'lobby.html', 'game.html', 'profile.html', 'admin.html', 'offline.html']) {
    assert.match(read(`public/${page}`), /<meta name="robots" content="noindex, nofollow"/);
  }

  for (const page of ['terms.html', 'account-deletion.html']) {
    assert.match(read(`public/${page}`), /<meta name="robots" content="noindex, follow"/);
  }
});

test('account deletion is available in-app and requires reauthentication', () => {
  const profile = read('public/profile.html');
  const route = read('routes/user.js');
  assert.match(profile, /function deleteAccount\(\)/);
  assert.match(profile, /currentPassword/);
  assert.match(profile, /ELIMINAR/);
  assert.match(route, /router\.delete\('\/me', requireAuth/);
  assert.match(route, /comparePassword\(currentPassword\)/);
  assert.match(route, /confirmation !== 'ELIMINAR'/);
  assert.match(route, /socket\.disconnect\(true\)/);
});

test('server keeps baseline browser protections enabled', () => {
  const server = read('server.js');
  for (const header of [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
    'Strict-Transport-Security',
  ]) {
    assert.match(server, new RegExp(header));
  }
  assert.match(server, /maxHttpBufferSize:\s*100_000/);
  assert.match(server, /perMessageDeflate:\s*false/);
});

test('JWT and password recovery remain hardened', () => {
  const auth = read('routes/auth.js');
  const middleware = read('middleware/auth.js');
  assert.match(auth, /algorithm:\s*'HS256'/);
  assert.match(middleware, /algorithms:\s*\['HS256'\]/);
  assert.match(auth, /expiresIn:\s*'7d'/);
  assert.match(auth, /tokenVersion/);
  assert.match(auth, /bcrypt\.hash\(recoveryCode, 12\)/);
  assert.match(auth, /limitLogin/);
  assert.match(auth, /limitReset/);
});

test('Socket.IO gameplay events are bound to auth, validation, room tokens, and rate limits', () => {
  const server = read('server.js');
  const lobby = read('public/lobby.html');
  const script = read('public/script.js');

  assert.match(server, /io\.use\(async \(socket, next\)/);
  assert.match(server, /jwt\.verify\(token, process\.env\.JWT_SECRET, \{ algorithms: \['HS256'\] \}\)/);
  assert.match(server, /socket\.data\.user =/);
  assert.match(server, /crypto\.randomBytes\(24\)\.toString\('hex'\)/);
  assert.match(server, /room\.tokens\[requestedColor\] !== token/);
  assert.match(server, /new RateLimiterMemory/);
  assert.match(server, /socketSchemas\.playerMove/);
  assert.match(server, /parseSocketPayload/);
  assert.match(server, /rawSocketOn/);

  assert.match(lobby, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
  assert.match(lobby, /const username = escapeHtml\(from\?\.username \|\| 'Jugador'\)/);
  assert.doesNotMatch(lobby, /<strong style="color:#C8983C">\$\{from\.username\}/);
  assert.match(script, /token: sessionStorage\.getItem\('ozama-room-token'\)/);
  assert.match(script, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
});

test('repository ignores local secrets and documents production variables', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  const example = read('.env.example');
  assert.match(example, /^MONGODB_URI=$/m);
  assert.match(example, /^JWT_SECRET=/m);
  assert.match(example, /^ADMIN_EMAILS=$/m);
  assert.doesNotMatch(example, /mongodb\+srv:\/\//i);
});

test('native runtime sends only API and socket traffic to production', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  const runtime = read('public/mobile-runtime.js');
  const server = read('server.js');
  assert.equal(config.appId, 'com.ozamachess.app');
  assert.equal(config.webDir, 'public');
  assert.equal(config.server.cleartext, false);
  assert.match(runtime, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(runtime, /socketOrigin: native \? productionOrigin : undefined/);
  assert.doesNotMatch(runtime, /MONGODB_URI|JWT_SECRET/);
  assert.match(server, /'https:\/\/localhost'/);
  assert.match(server, /appOriginAllowed/);
});

test('Android release base blocks backups and cleartext traffic', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const gradle = read('android/app/build.gradle');
  const buildScript = read('scripts/android-build.js');
  const installScript = read('scripts/android-install.js');
  const gitignore = read('.gitignore');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(buildScript, /\.tools', 'jdk21'/);
  assert.match(buildScript, /majorVersion < 21/);
  assert.match(buildScript, /platforms', 'android-36'/);
  assert.match(buildScript, /OZAMA_UPLOAD_STORE_FILE/);
  assert.match(buildScript, /gradlew\.bat --no-daemon/);
  assert.match(gradle, /System\.getenv\('OZAMA_UPLOAD_STORE_FILE'\)/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.match(installScript, /adb\.exe/);
  assert.match(installScript, /Depuracion USB/);
  assert.match(gitignore, /^\.tools\/$/m);
  assert.match(gitignore, /^\*\.jks$/m);
  assert.ok(fs.statSync(path.join(root, 'public/vendor/socket.io.min.js')).size > 10_000);
  assert.ok(fs.statSync(path.join(root, 'resources/icon.png')).size > 10_000);
});
