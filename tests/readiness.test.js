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
  // xp/achievements/equippedFrame/equippedTitle (Fase 23, "Ranking"):
  // se agregaron para mostrar nivel/titulo/marco en el ranking, mismos
  // campos que ya son publicos en player.html -- la guarda real de
  // esta prueba son los doesNotMatch de abajo (nunca email/lastSeenAt),
  // no la lista exacta de campos publicos, que puede crecer.
  assert.match(route, /\.select\('username country avatar avatarImage elo stats plan premiumUntil xp achievements equippedFrame equippedTitle'\)/);
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

// Paridad Ajedrez/Damas (Fase 37, QA): en Ajedrez, quien se desconecta y
// no vuelve en 30s PIERDE (el que se quedo gana con ELO). Damas trataba
// todo 'opponent-left' como 'abandoned' sin tocar nada -- quien iba
// perdiendo cerraba la pestaña sin penalizacion. Ver
// scripts/verify-forfeit-parity.js para la prueba de comportamiento.
test('Damas counts a lone disconnect as a real loss, like Chess, and history labels it per side', () => {
  const server = read('server.js');
  assert.match(server, /const forfeitWin = reason === 'opponent-left' && \(winner === 'w' \|\| winner === 'b'\);/);
  assert.match(server, /const abandoned = reason === 'admin-closed' \|\| \(reason === 'opponent-left' && !forfeitWin\);/);
  const history = read('public/history.html');
  assert.match(history, /const leftAndLost = m\.reason === 'opponent-left' && won === false && result !== 'abandoned';/);
  assert.match(history, /'Te desconectaste'/);
});

// Base de datos (Fase 34): una auditoria anterior (OZAMA_PRO_AUDIT.md,
// seccion 27) habia encontrado que User no tenia indice en elo/
// damasElo pese a que el ranking ordena por esos campos, y que
// DamasMatch no tenia indice en result. Auditando esta fase se
// encontro que esos indices YA estaban declarados -- lo unico sin
// confirmar era que el query planner de Mongo realmente los usa (ver
// scripts/verify-database-indices.js, que lo prueba con datos reales
// via explain()). Este pin es la guarda barata: si alguien borra la
// declaracion sin querer, esto falla al instante en `npm test`, sin
// esperar a correr el script pesado contra Mongo.
test('the leaderboard/climbers/history hot-path indices stay declared', () => {
  const user = read('models/User.js');
  assert.match(user, /UserSchema\.index\(\{ elo: -1 \}\)/);
  assert.match(user, /UserSchema\.index\(\{ damasElo: -1 \}\)/);
  const match = read('models/Match.js');
  assert.match(match, /MatchSchema\.index\(\{ result: 1 \}\)/);
  assert.match(match, /MatchSchema\.index\(\{ endedAt: -1 \}\)/);
  assert.match(match, /MatchSchema\.index\(\{ 'whitePlayer\.userId': 1, createdAt: -1 \}\)/);
  assert.match(match, /MatchSchema\.index\(\{ 'blackPlayer\.userId': 1, createdAt: -1 \}\)/);
  const damasMatch = read('models/DamasMatch.js');
  assert.match(damasMatch, /DamasMatchSchema\.index\(\{ result: 1 \}\)/);
  assert.match(damasMatch, /DamasMatchSchema\.index\(\{ endedAt: -1 \}\)/);
});

// Accesibilidad (Fase 32): theme.css ya trae un :focus-visible global
// desde una fase anterior, pero 9 paginas no lo importan en absoluto
// (index/admin/leaderboard/offline y las 4 legales via legal.css) --
// quien navega por teclado dependia del outline nativo del navegador
// ahi, sin nada que coincida con el tema (y en admin.html, un
// outline:none en los inputs sin ningun :focus-visible que lo
// reemplace). De paso, 6 <img> de banderas de pais en damas.html/
// game.html/lobby.html no tenian alt -- un lector de pantalla los
// anunciaba sin nombre.
test('pages without theme.css still get a visible keyboard focus ring', () => {
  const legal = read('public/legal.css');
  assert.match(legal, /:focus-visible \{[^}]*outline: 2px solid var\(--gold\) !important;/);
  for (const page of ['public/index.html', 'public/admin.html', 'public/leaderboard.html']) {
    const html = read(page);
    assert.match(html, /:focus-visible \{ outline: 2px solid var\(--gold\) !important; outline-offset: 2px !important; \}/, `${page} deberia definir su propio :focus-visible`);
  }
  assert.match(read('public/offline.html'), /:focus-visible \{ outline: 2px solid #C8983C !important;/);
});

test('country flag images always carry an alt attribute for screen readers', () => {
  for (const page of ['public/damas.html', 'public/game.html', 'public/lobby.html']) {
    const html = read(page);
    const imgTags = html.match(/<img[^>]*flagcdn\.com[^>]*>/g) || [];
    assert.ok(imgTags.length > 0, `${page} deberia tener al menos una bandera de flagcdn.com para que esta prueba tenga sentido`);
    for (const tag of imgTags) {
      assert.match(tag, /alt=/, `${page}: "${tag}" deberia tener alt`);
    }
  }
});

// Responsive (Fase 31): la auditoria de Fase 0 ya habia marcado
// profile.html como uno de los mas debiles en breakpoints. Auditando
// esta fase se encontraron dos bugs reales: (1) "Coleccion" faltaba
// del selector de pestañas en history.html y settings.html -- solo
// se podia llegar a esa pagina desde profile.html; (2) con las 4
// pestañas completas, la ultima se cortaba de golpe en un telefono
// angosto sin ningun indicio de que habia mas para desplazar, y la
// pestaña ACTIVA (ej. "Ajustes") podia arrancar cortada sin scrollear
// sola a la vista.
test('the Perfil/Historial/Colección/Ajustes tab bar stays consistent and usable on narrow screens', () => {
  for (const page of ['public/profile.html', 'public/history.html', 'public/settings.html']) {
    const html = read(page);
    for (const href of ['/profile.html', '/history.html', '/collection.html', '/settings.html']) {
      assert.match(html, new RegExp(`href="${href.replace('.', '\\.')}" class="\\s?profile-tab`), `${page} deberia enlazar ${href} en su selector de pestañas`);
    }
    assert.match(html, /mask-image: linear-gradient\(to right, #000 calc\(100% - 28px\), transparent 100%\)/, `${page} deberia difuminar el borde de la barra de pestañas cuando hay mas para desplazar`);
    assert.match(html, /document\.querySelector\('\.profile-tab\.is-active'\)\?\.scrollIntoView/, `${page} deberia llevar la pestaña activa a la vista si arranca cortada`);
  }
});

// Sonido (Fase 30): Damas ya distinguia victoria de derrota
// tonalmente desde antes de esta fase (playWinSound/playLoseSound en
// damas.html) -- Ajedrez usaba el mismo 'gameover' neutro para ganar,
// perder Y tablas, la unica asimetria real que encontro la auditoria
// de Fase 0. Se agregaron _soundVictory/_soundDefeat + un helper de
// perspectiva (playOutcomeSound/myColorForSound). El bug real que se
// encontro armando esto: en modo bot, PLAYER_COLOR queda VACIO
// (lobby.html borra 'ozama-color' antes de arrancar contra el bot) --
// comparar el ganador contra PLAYER_COLOR directo habria dado
// 'defeat' SIEMPRE en modo bot, incluso ganando. myColorForSound()
// resuelve el color real del jugador en modo bot via enemy(BOT_COLOR).
test('chess distinguishes victory from defeat by sound, matching Damas, with the bot-mode PLAYER_COLOR gotcha handled', () => {
  const script = read('public/script.js');
  assert.match(script, /function _soundVictory\(/);
  assert.match(script, /function _soundDefeat\(/);
  assert.match(script, /function myColorForSound\(\)/);
  // El bug real: PLAYER_COLOR esta vacio en modo bot, hay que usar
  // enemy(BOT_COLOR) -- no comparar contra PLAYER_COLOR a secas.
  assert.match(script, /if \(IS_BOT_MODE\) return enemy\(BOT_COLOR\);/);
  assert.match(script, /function playOutcomeSound\(winnerColor\)/);
  // Los finales donde SI se puede saber quien gano usan el helper
  // perspectiva-consciente, no el 'gameover' neutro de siempre.
  assert.match(script, /state\.winner = enemy\(state\.turn\);\s*\n\s*playOutcomeSound\(state\.winner\);/);
  assert.match(script, /playOutcomeSound\(winner\);/); // handleClockTimeout
  assert.match(script, /playSound\(IS_LOCAL_MODE \? 'gameover' : 'defeat'\);/); // completeResignation: rendirse siempre es mi derrota
  assert.match(script, /playSound\(IS_SPECTATE \? 'gameover' : 'victory'\);/); // opponent-resigned: el rival se rindio, yo gano
});

// Idiomas (Fase 29): landing, login/registro y lobby se tradujeron
// como v1 real (public/i18n.js + public/locales/{es,en}.json). Un
// [data-i18n="key"] o t('key') sin esa key en ambos diccionarios no
// truena -- i18n.js cae de vuelta al KEY MISMO como texto visible
// (ver t() en i18n.js), un bug silencioso que solo se nota mirando la
// pantalla. Esta prueba recorre las 3 paginas y confirma que cada key
// referenciada (en markup o en <script>) resuelve en los dos idiomas,
// para que un data-i18n nuevo sin su traduccion no pase desapercibido.
test('every data-i18n / t() key used in the translated pages resolves in both locales', () => {
  const es = JSON.parse(read('public/locales/es.json'));
  const en = JSON.parse(read('public/locales/en.json'));
  const lookup = (dict, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dict);

  const pages = ['public/index.html', 'public/login.html', 'public/lobby.html'];
  const markupRe = /data-i18n(?:-placeholder|-aria-label|-title)?="([^"]+)"/g;
  const jsRe = /(?:\bt\(|OZAMA_I18N\??\.t\()\s*['"]([a-zA-Z0-9_.]+)['"]/g;

  let checked = 0;
  for (const page of pages) {
    const html = read(page);
    for (const re of [markupRe, jsRe]) {
      let match;
      while ((match = re.exec(html))) {
        const key = match[1];
        checked++;
        assert.ok(lookup(es, key) !== undefined, `${page}: "${key}" no existe en locales/es.json`);
        assert.ok(lookup(en, key) !== undefined, `${page}: "${key}" no existe en locales/en.json`);
      }
    }
  }
  assert.ok(checked > 150, `deberian haber bastantes keys de i18n referenciadas para que esta prueba tenga sentido, se revisaron ${checked}`);
});

// PWA (Fase 28): damas.html y watch.html no tenian NINGUNA etiqueta de
// PWA (ni <link rel="manifest">, ni el script pwa.js que registra el
// service worker) -- Damas, uno de los dos juegos centrales, y la
// pagina de espectador (a menudo la PRIMERA que ve un visitante nuevo,
// via un link compartido) quedaban completamente afuera del modo
// instalable. Esta prueba evita que una pagina nueva vuelva a quedar
// afuera por accidente: pieces-preview.html (herramienta interna, sin
// CSP ni titulo real) y offline.html (la pagina de respaldo misma --
// registrar el service worker ahi seria circular) son las unicas
// excepciones legitimas.
test('every real user-facing page registers the installable PWA (manifest + service worker)', () => {
  const excluded = new Set(['pieces-preview.html']);
  const pwaOptional = new Set(['offline.html']);
  const pages = fs.readdirSync(path.join(root, 'public'))
    .filter((file) => file.endsWith('.html') && !excluded.has(file));
  assert.ok(pages.length > 20, 'deberia haber bastantes paginas publicas para que esta prueba tenga sentido');
  for (const page of pages) {
    const html = read(`public/${page}`);
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, `${page} deberia enlazar el manifest de la PWA`);
    if (!pwaOptional.has(page)) {
      assert.match(html, /<script src="\/pwa\.js"/, `${page} deberia registrar el service worker (pwa.js)`);
    }
  }
});

// Resiliencia de proceso (Fase 27): sin estos handlers, Render mata el
// proceso de golpe en cada deploy (SIGTERM sin manejar) o una sola
// promesa sin capturar tumba TODAS las partidas en curso de TODOS los
// jugadores (unhandledRejection sin manejar). Ver scripts/verify-
// graceful-shutdown.js para la prueba de comportamiento real.
test('server.js survives an unhandled rejection and shuts down cleanly on SIGTERM', () => {
  const server = read('server.js');
  assert.match(server, /process\.on\('unhandledRejection',/);
  assert.match(server, /process\.on\('uncaughtException',/);
  assert.match(server, /process\.on\('SIGTERM',.*gracefulShutdown/);
  assert.match(server, /process\.on\('SIGINT',.*gracefulShutdown/);
  // io.close() ya cierra el http.Server que le pasamos -- llamar
  // tambien a server.close() por separado cierra el mismo handle dos
  // veces y en Windows eso hace que el proceso truene (visto en vivo
  // al construir esta fase). No debe volver a aparecer.
  assert.doesNotMatch(server, /io\.close\(\);\s*\n\s*server\.close\(/);
});

// Dispositivos y viewports (Fase 38): la auditoria manual recorrio las
// ~26 paginas publicas mas los tableros de Ajedrez y Damas (con una
// partida real contra el bot) en 320px, 375px, 768px y 1440px, y no
// encontro overflow horizontal en ninguna -- cada pagina ya declara el
// viewport responsivo y una red de seguridad `overflow-x:hidden` en
// html/body (propia o heredada de theme.css/style.css), y los pocos
// contenedores mas anchos que la pantalla (tabla de ranking, pestañas,
// tablas de admin) son scroll interno a proposito (`overflow-x:auto`),
// no fuga de la pagina. Estas dos pruebas fijan ese estado para que una
// pagina nueva, o una que pierda el meta viewport o la red de
// seguridad, no vuelva a romper el layout movil sin que nadie lo note.
test('every public page declares the responsive viewport meta tag', () => {
  const pages = fs.readdirSync(path.join(root, 'public')).filter((file) => file.endsWith('.html'));
  assert.ok(pages.length > 20, 'deberia haber bastantes paginas publicas para que esta prueba tenga sentido');
  for (const page of pages) {
    const html = read(`public/${page}`);
    assert.match(html, /<meta name="viewport" content="width=device-width/, `${page} deberia declarar el meta viewport responsivo`);
  }
});

test('every public page keeps a horizontal-overflow safety net, own or shared', () => {
  // pieces-preview.html es la misma herramienta interna que ya excluye
  // el test de PWA de arriba (sin CSP ni titulo real).
  const pages = fs.readdirSync(path.join(root, 'public'))
    .filter((file) => file.endsWith('.html') && file !== 'pieces-preview.html');
  const ownGuard = /(?:html,\s*body|body)\s*\{[^}]*overflow-x:\s*hidden/;
  const sharedSheet = /<link rel="stylesheet" href="\/(theme|style|legal)\.css">/;
  for (const page of pages) {
    const html = read(`public/${page}`);
    assert.ok(
      ownGuard.test(html) || sharedSheet.test(html),
      `${page} deberia traer 'overflow-x:hidden' en html/body (propio o via theme.css/style.css/legal.css)`
    );
  }
  // Las hojas compartidas son la red de seguridad real para las paginas
  // que no la declaran inline -- si esto se borra, todas esas paginas
  // pierden la proteccion de golpe. legal.css no la traia (unica
  // excepcion real que encontro esta fase, ver commit) -- ya se agrego.
  assert.match(read('public/theme.css'), /html,\s*body\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(read('public/style.css'), /body\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(read('public/legal.css'), /body\s*\{[^}]*overflow-x:\s*hidden/);
});

// Concurrencia y carga (Fase 39): quick-match (Ajedrez y Damas) hace 2
// await (getPlayerInfo, blockedUsers) antes de empujar a la cola o de
// emparejar. Sin un guardia de reentrada, un segundo 'quick-match' del
// MISMO socket que llega antes de que el primero termine esos await
// (doble click, o un reintento del cliente por lentitud bajo carga) se
// cuela con una segunda entrada fantasma -- y si otro rival empareja
// con ella, el jugador queda arrancado de su primera partida sin
// aviso (createMatchBetween/createDamasMatchBetween pisan
// socket.data.roomCode sin comprobar si ya habia uno). Ver
// scripts/verify-matchmaking-reentry.js para la reproduccion real
// (falla contra el server.js de antes de esta fase).
test('quick-match guards against the same socket re-entering matchmaking before its first call finishes', () => {
  const server = read('server.js');
  assert.match(server, /const matchmakingInFlight = new Set\(\);/);
  assert.match(server, /const damasMatchmakingInFlight = new Set\(\);/);
  assert.match(server, /if \(matchmakingInFlight\.has\(socket\.id\)\) return;\s*\n\s*matchmakingInFlight\.add\(socket\.id\);/);
  assert.match(server, /if \(damasMatchmakingInFlight\.has\(socket\.id\)\) return;\s*\n\s*damasMatchmakingInFlight\.add\(socket\.id\);/);
  assert.match(server, /matchmakingInFlight\.delete\(socket\.id\);/);
  assert.match(server, /damasMatchmakingInFlight\.delete\(socket\.id\);/);
});

// Flujos completos de usuario end-to-end (Fase 40): jugando una
// partida de verdad por el navegador -- registro real, quick-match
// real contra un rival real, y "Rendirse" real -- salieron dos bugs
// del lado del cliente que ningun script de verificacion contra el
// backend (Fases 36-39) podia atrapar, porque ninguno carga game.html
// ni corre public/script.js de verdad en un navegador.
//
// 1) En una conexion rapida, el socket de game.html ya podia estar
// conectado para cuando el codigo sincrono llegaba al
// `if (socket.connected) rejoin()` de mas abajo -- el handler de
// 'connect' YA habia disparado rejoin() una vez, y esa linea lo volvia
// a disparar para la MISMA conexion. server.js reemite
// 'opponent-reconnected' en cada rejoin: el RIVAL veia el mensaje de
// sistema "X reconectado" duplicado al arrancar una partida nueva, sin
// que nadie se hubiera desconectado nunca.
//
// 2) completeResignation() y el handler de 'opponent-resigned' reusan
// STATUS.CHECKMATE (no hay un estado propio para "se rindio") para
// cerrar la partida -- pero updateStatusDisplay() (el letrero de
// arriba del tablero, DISTINTO del modal de fin de partida, que si
// acertaba con "TE RENDISTE") solo sabia distinguir 'timeout' de
// 'endReason', nunca 'resign' -- una rendicion de VERDAD (nadie dio
// jaque mate) mostraba "¡Jaque Mate!" arriba del tablero, para los DOS
// jugadores.
test('game.html avoids a duplicate rejoin on a fast first connect, and the resign banner never claims checkmate', () => {
  const script = read('public/script.js');
  assert.match(script, /let _rejoinedThisConnection = false;/);
  assert.match(script, /function rejoinOnce\(\) \{\s*\n\s*if \(_rejoinedThisConnection\) return;/);
  assert.match(script, /socket\.on\('disconnect', \(\) => \{\s*\n\s*_rejoinedThisConnection = false;/);
  assert.match(script, /if \(socket\.connected\) rejoinOnce\(\);/);
  assert.doesNotMatch(script, /if \(socket\.connected\) rejoin\(\);/);

  assert.match(script, /state\.endReason === 'resign'\s*\n\s*\? `Rendición\. Ganan las/);
  assert.match(script, /socket\.on\('opponent-resigned', \(\{ playerName \} = \{\}\) => \{\s*\n\s*CLOCK\.stop\(\);\s*\n\s*playSound\(IS_SPECTATE \? 'gameover' : 'victory'\);\s*\n\s*state\.status = STATUS\.CHECKMATE;\s*\n\s*state\.endReason = 'resign';/);
});
