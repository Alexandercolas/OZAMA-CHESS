'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('../scripts/test-db-guard');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('PWA manifest exposes installable application assets', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const pwa = read('public/pwa.js');
  assert.equal(manifest.name, 'OZAMA CHESS');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.match(pwa, /beforeinstallprompt/);
  assert.match(pwa, /appinstalled/);
  assert.match(pwa, /Agregar a pantalla de inicio/);
  assert.match(pwa, /OZAMA_RUNTIME\?\.native/);
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

test('admin control plane is allowlisted, rate limited, and server-authorized', () => {
  const middleware = read('middleware/auth.js');
  const admin = read('routes/admin.js');
  const server = read('server.js');
  const panel = read('public/admin.html');
  const panelScript = read('public/js/admin.js');
  const accessScript = read('public/js/admin-access.js');

  assert.match(middleware, /adminEmails\(\)\.includes/);
  assert.match(middleware, /if \(!user\?\.isActive\) return false/);
  assert.doesNotMatch(middleware, /if \(user\.isAdmin\) return true/);
  assert.match(admin, /router\.use\(requireAdmin\)/);
  assert.match(admin, /new RateLimiterMemory/);
  assert.match(admin, /router\.get\(\['\/verify', '\/me'\]/);
  assert.match(admin, /router\.patch\('\/users\/:id'/);
  assert.match(admin, /router\.get\('\/rooms\/active'/);
  assert.match(admin, /router\.delete\('\/rooms\/:code'/);
  assert.match(admin, /router\.get\('\/matches'/);
  assert.match(admin, /router\.get\('\/system'/);
  assert.match(admin, /\.select\(publicUserFields\)/);
  assert.doesNotMatch(admin.match(/const publicUserFields = ([^;]+)/)?.[1] || '', /password|recoveryCodeHash|tokenVersion|__v/);
  assert.match(server, /app\.locals\.adminRuntime/);
  assert.match(server, /roomSocket\.emit\('room-closed'/);
  assert.match(panel, /<script src="\/js\/admin\.js" defer><\/script>/);
  assert.doesNotMatch(panel, /ADMIN_EMAILS|localStorage\.getItem/);
  assert.match(panelScript, /api\('\/api\/admin\/verify'\)/);
  assert.match(accessScript, /fetch\('\/api\/admin\/verify'/);
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
  assert.match(server, /function getServerGameConclusion\(game\)/);
  assert.match(server, /async function finishRoomByServerConclusion\(room, code/);
  assert.match(server, /await finishRoomByServerConclusion\(room, code, 'move'\)/);

  assert.match(lobby, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
  assert.match(lobby, /const username = escapeHtml\(from\?\.username \|\| 'Jugador'\)/);
  assert.doesNotMatch(lobby, /<strong style="color:#C8983C">\$\{from\.username\}/);
  assert.match(script, /token: sessionStorage\.getItem\('ozama-room-token'\)/);
  assert.match(script, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
  assert.match(script, /socket\.on\('game-finished'/);
});

test('repository ignores local secrets and documents production variables', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  const example = read('.env.example');
  assert.match(example, /^MONGODB_URI=$/m);
  assert.match(example, /^MONGODB_DB_NAME=ozama-chess$/m);
  assert.match(example, /^JWT_SECRET=/m);
  assert.match(example, /^ADMIN_EMAILS=$/m);
  assert.doesNotMatch(example, /mongodb\+srv:\/\//i);
});

test('dynamic test scripts cannot target the production MongoDB database', () => {
  assert.throws(
    () => assertSafeTestDatabase({ uri: 'mongodb://localhost/ozama-chess', dbName: 'ozama-chess' }),
    /Refusing to run test script against production database/,
  );
  assert.throws(
    () => assertSafeTestDatabase({ uri: 'mongodb://localhost/dev-scratch', dbName: 'dev-scratch' }),
    /Refusing to run test script against non-temporary database/,
  );

  const isolated = createIsolatedMongoEnv({
    env: { MONGODB_URI: 'mongodb://localhost/ozama-chess' },
    prefix: 'ozama_dynamic_security',
  });
  assert.match(isolated.dbName, /^ozama_dynamic_security_\d{8,}$/);
  assert.equal(isolated.env.MONGODB_DB_NAME, isolated.dbName);
});

test('public leaderboard stays finite and excludes known test accounts', () => {
  const route = read('routes/user.js');
  assert.match(route, /function publicLeaderboardFilter\(\)/);
  assert.match(route, /\$not: \/\^sec\[A-D\]_\\d\{8\}\$\/i/);
  assert.match(route, /\$nin: \['imgsrconeerror'\]/);
  assert.match(route, /\.limit\(20\)/);
  assert.match(route, /\.select\('username country avatar avatarImage elo stats plan'\)/);
  assert.doesNotMatch(route, /\.select\([^)]*email/);
  assert.doesNotMatch(route, /\.select\([^)]*lastSeenAt/);
});

test('native runtime sends only API and socket traffic to production', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  const runtime = read('public/mobile-runtime.js');
  const game = read('public/game.html');
  const gameScript = read('public/script.js');
  const server = read('server.js');
  assert.equal(config.appId, 'com.ozamachess.app');
  assert.equal(config.webDir, 'public');
  assert.equal(config.server.cleartext, false);
  assert.match(runtime, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(runtime, /socketOrigin: native \? productionOrigin : undefined/);
  assert.match(runtime, /safe-area-inset-top/);
  assert.match(runtime, /appStateChange/);
  assert.match(runtime, /backButton/);
  assert.match(runtime, /CustomEvent\('ozama:resume'/);
  assert.match(game, /OZAMA_HANDLE_NATIVE_BACK/);
  assert.match(gameScript, /addEventListener\('ozama:resume', resumeOnlineSession\)/);
  assert.doesNotMatch(runtime, /MONGODB_URI|JWT_SECRET/);
  assert.match(server, /'https:\/\/localhost'/);
  assert.match(server, /appOriginAllowed/);
});

test('Android release base blocks backups and cleartext traffic', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const gradle = read('android/app/build.gradle');
  const buildScript = read('scripts/android-build.js');
  const installScript = read('scripts/android-install.js');
  const styles = read('android/app/src/main/res/values/styles.xml');
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
  assert.match(styles, /android:statusBarColor">#0D0B08/);
  assert.match(styles, /android:navigationBarColor">#0D0B08/);
  assert.match(styles, /android:windowLightStatusBar">false/);
  assert.match(gitignore, /^\.tools\/$/m);
  assert.match(gitignore, /^\*\.jks$/m);
  assert.ok(fs.statSync(path.join(root, 'public/vendor/socket.io.min.js')).size > 10_000);
  assert.ok(fs.statSync(path.join(root, 'resources/icon.png')).size > 10_000);
});
