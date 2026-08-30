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
  // Vive en settings.html (no profile.html) desde que Perfil/Historial/
  // Ajustes se separaron en pestanas propias.
  const profile = read('public/settings.html');
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

test('Google sign-in is feature-gated and verified by the backend', () => {
  const auth = read('routes/auth.js');
  const google = read('services/google-auth.js');
  const model = read('models/User.js');
  const login = read('public/login.html');
  const server = read('server.js');
  const packageJson = JSON.parse(read('package.json'));

  assert.ok(packageJson.dependencies['google-auth-library']);
  assert.match(google, /googleClient\.verifyIdToken/);
  assert.match(google, /audience/);
  assert.match(google, /payload\.email_verified !== true/);
  assert.match(google, /payload\?\.sub/);
  assert.match(auth, /router\.get\('\/providers'/);
  assert.match(auth, /router\.post\('\/google', limitGoogle/);
  assert.match(auth, /setSessionCookie\(res, token\)/);
  assert.match(auth, /User\.findOne\(\{ googleSub: sub \}\)/);
  assert.match(model, /googleSub:/);
  assert.match(model, /select: false/);
  assert.match(login, /fetch\('\/api\/auth\/providers'/);
  assert.match(login, /fetch\('\/api\/auth\/google'/);
  assert.match(login, /if \(window\.OZAMA_RUNTIME\?\.native\) \{/);
  assert.doesNotMatch(login, /GOOGLE_ANDROID_CLIENT_ID|GOOGLE_CLIENT_IDS/);
  assert.match(server, /googleLoginEnabled/);
  assert.match(server, /same-origin-allow-popups/);
});

test('web sessions use hardened HttpOnly cookies with a native Bearer fallback', () => {
  const session = read('middleware/session.js');
  const middleware = read('middleware/auth.js');
  const auth = read('routes/auth.js');
  const server = read('server.js');
  const runtime = read('public/mobile-runtime.js');
  const login = read('public/login.html');

  assert.match(session, /httpOnly: true/);
  assert.match(session, /secure: hostedOverHttps/);
  assert.match(session, /sameSite: 'lax'/);
  assert.match(session, /protectCookieWrites/);
  assert.match(session, /origin === requestOrigin\(req\)/);
  assert.match(middleware, /requestToken\(req\)/);
  assert.match(auth, /setSessionCookie\(res, token\)/);
  assert.match(auth, /router\.post\('\/logout'/);
  assert.match(auth, /router\.post\('\/migrate-session', requireAuth/);
  assert.match(server, /app\.use\('\/api', protectCookieWrites\)/);
  assert.match(server, /const token = socketToken\(socket\)/);
  assert.match(server, /credentials: true/);
  assert.match(runtime, /migrateLegacyWebSession/);
  assert.match(runtime, /localStorage\.removeItem\('ozama-token'\)/);
  assert.match(login, /await window\.OZAMA_RUNTIME\?\.ready/);
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
  assert.match(server, /reason: 'stalemate'/);
  assert.match(server, /reason: 'fifty_move'/);
  assert.match(server, /reason: conclusion\.reason/);
  assert.match(server, /async function finishRoomByServerConclusion\(room, code/);
  assert.match(server, /await finishRoomByServerConclusion\(room, code, 'move'\)/);

  assert.match(lobby, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
  assert.match(lobby, /const username = escapeHtml\(from\?\.username \|\| 'Jugador'\)/);
  assert.doesNotMatch(lobby, /<strong style="color:#C8983C">\$\{from\.username\}/);
  assert.match(script, /token: sessionStorage\.getItem\('ozama-room-token'\)/);
  assert.match(script, /sessionStorage\.setItem\('ozama-room-token', roomToken\)/);
  assert.match(script, /socket\.on\('game-finished'/);
  assert.match(script, /Partida empatada por rey ahogado/);
  assert.match(script, /regla de 50 movimientos/);
});

test('repository ignores local secrets and documents production variables', () => {
  assert.match(read('.gitignore'), /^\.env$/m);
  assert.match(read('.gitignore'), /^\*\.jks$/m);
  assert.match(read('.gitignore'), /^\*\.keystore$/m);
  const example = read('.env.example');
  assert.match(example, /^MONGODB_URI=$/m);
  assert.match(example, /^MONGODB_DB_NAME=ozama-chess$/m);
  assert.match(example, /^JWT_SECRET=/m);
  assert.match(example, /^ADMIN_EMAILS=$/m);
  assert.match(example, /^GOOGLE_WEB_CLIENT_ID=$/m);
  assert.match(example, /^GOOGLE_ANDROID_CLIENT_ID=$/m);
  assert.doesNotMatch(example, /mongodb\+srv:\/\//i);

  const signedBuild = read('scripts/build-android-signed.ps1');
  assert.match(signedBuild, /Read-Host 'Contrasena de la llave de subida' -AsSecureString/);
  assert.match(signedBuild, /ZeroFreeBSTR/);
  assert.match(signedBuild, /Remove-Item Env:OZAMA_UPLOAD_STORE_PASSWORD/);
  assert.doesNotMatch(signedBuild, /CONTRASENA_PRIVADA|storePassword\s*=|keyPassword\s*=/i);
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
  assert.match(route, /\.select\('username country avatar avatarImage elo stats plan premiumUntil'\)/);
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

test('Android stores the native session with a non-exportable Keystore key', () => {
  const plugin = read('android/app/src/main/java/com/ozamachess/app/OzamaSecureStoragePlugin.java');
  const activity = read('android/app/src/main/java/com/ozamachess/app/MainActivity.java');
  const runtime = read('public/mobile-runtime.js');
  const login = read('public/login.html');

  assert.match(activity, /registerPlugin\(OzamaSecureStoragePlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(name = "OzamaSecureStorage"\)/);
  assert.match(plugin, /AndroidKeyStore/);
  assert.match(plugin, /AES\/GCM\/NoPadding/);
  assert.match(plugin, /setKeySize\(256\)/);
  assert.match(plugin, /setRandomizedEncryptionRequired\(true\)/);
  assert.match(plugin, /cipher\.updateAAD\(AAD\)/);
  assert.match(runtime, /initializeNativeSession/);
  assert.match(runtime, /storage\.writeToken\(\{ value: legacy \}\)/);
  assert.match(runtime, /getAuthToken: \(\) => authToken/);
  assert.match(runtime, /storeAuthToken/);
  assert.match(runtime, /clearAuthToken/);
  assert.match(login, /await window\.OZAMA_RUNTIME\?\.storeAuthToken/);

  for (const file of [
    'public/index.html',
    'public/leaderboard.html',
    'public/lobby.html',
    'public/login.html',
    'public/profile.html',
    'public/script.js',
    'public/js/admin.js',
    'public/js/admin-access.js',
  ]) {
    assert.doesNotMatch(read(file), /localStorage\.(?:getItem|setItem)\('ozama-token'/);
  }
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
