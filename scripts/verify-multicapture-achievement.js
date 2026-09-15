'use strict';

// Prueba de "Logros" (Fase 14 del roadmap "OZAMA PRO"): auditoria
// previa encontro que el catalogo de logros ya era amplio (20
// entradas) y ya se mostraba en profile.html/collection.html/
// dashboard.html/player.html (badges publicos) -- pero Damas solo
// tenia UN logro propio (primera_coronacion) frente a los dos de
// Ajedrez (victoria_relampago, maratonista). server.js YA calculaba
// result.captured.length por jugada (la cadena COMPLETA de saltos
// resuelta por el motor real, no una aproximacion) para el contador
// visual capturedCount, pero nunca lo usaba para nada persistente --
// exactamente el mismo caso que result.promoted, que SI ya alimentaba
// el logro "Primera Coronacion" via room.hadPromotion. Este script
// verifica, SIN necesitar jugar una partida completa por socket real
// (el tablero inicial no permite forzar una posicion especifica):
//
//   1. contra el motor REAL de Damas (public/checkers-engine.js, el
//      mismo que corre en el cliente y en el servidor), una posicion
//      con captura multiple forzada produce una cadena de captura de
//      3 o mas piezas -- prueba que el umbral ">=3" elegido en
//      server.js es alcanzable con una jugada legal real, no un
//      numero arbitrario;
//   2. contra services/achievements.js (la logica que server.js
//      realmente ejecuta al cerrar una partida de Damas), un contexto
//      con justMultiCapture:true desbloquea 'captura_multiple' SOLO
//      en Damas (nunca en Ajedrez, mismo gating que primera_coronacion)
//      y SOLO la primera vez (no se repite si ya esta desbloqueado);
//   3. contra un server.js real + Mongo aislada, GET /api/user/achievements
//      incluye la entrada nueva con progress:null (evento puntual, no
//      un contador) y unlocked:false para un usuario nuevo.
//
// Uso: node scripts/verify-multicapture-achievement.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

function verifyEngineProducesTripleCapture() {
  const OzamaCheckers = require('../public/checkers-engine.js');
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));

  // Blanca en (6,1); negras en zigzag para forzar una cadena de 3
  // capturas obligatorias (regla de captura multiple + mayoria, ambas
  // ya implementadas en el motor real). Coordenadas [row, col].
  board[6][1] = { color: 'w', king: false };
  board[5][2] = { color: 'b', king: false };
  board[3][2] = { color: 'b', king: false };
  board[1][2] = { color: 'b', king: false };

  const sequences = OzamaCheckers.getLegalMovesForSquare(board, 6, 1);
  assert(sequences.length >= 1, 'la posicion armada deberia tener al menos una secuencia de captura legal');
  const longest = sequences.reduce((a, b) => (b.length > a.length ? b : a), sequences[0]);
  assert(longest.length === 3, `la cadena deberia capturar exactamente 3 piezas, el motor real dio ${longest.length}`);

  const result = OzamaCheckers.applyMove(board, 6, 1, longest);
  assert(result.captured.length === 3, `result.captured.length deberia ser 3 (mismo campo que usa server.js), vino ${result.captured.length}`);
  console.log('engine: una captura multiple real en Damas encadena 3 piezas (result.captured.length === 3) -- el umbral de server.js es alcanzable.');
}

function verifyAchievementLogic() {
  const { buildContext, checkNewAchievements, ACHIEVEMENT_MAP } = require('../services/achievements');

  assert(ACHIEVEMENT_MAP.has('captura_multiple'), '"captura_multiple" deberia existir en el catalogo');

  const baseUser = () => ({ achievements: [], stats: {}, damasStats: {}, puzzles: {}, damasPuzzles: {} });

  // Damas + justMultiCapture:true -> desbloquea.
  const u1 = baseUser();
  const ctx1 = buildContext({ user: u1, game: 'damas', outcome: 'win', opponentElo: 1200, moveCount: 0, endedAt: new Date(), justMultiCapture: true });
  const unlocked1 = checkNewAchievements(u1, ctx1);
  assert(unlocked1.includes('captura_multiple'), `deberia desbloquear captura_multiple en Damas con justMultiCapture:true, vino ${JSON.stringify(unlocked1)}`);
  console.log('achievements: justMultiCapture:true en Damas desbloquea "captura_multiple".');

  // Damas + justMultiCapture:false -> NO desbloquea.
  const u2 = baseUser();
  const ctx2 = buildContext({ user: u2, game: 'damas', outcome: 'win', opponentElo: 1200, moveCount: 0, endedAt: new Date(), justMultiCapture: false });
  const unlocked2 = checkNewAchievements(u2, ctx2);
  assert(!unlocked2.includes('captura_multiple'), 'NO deberia desbloquear captura_multiple sin justMultiCapture');
  console.log('achievements: sin justMultiCapture, "captura_multiple" no se desbloquea.');

  // Ajedrez + justMultiCapture:true -> NO desbloquea (gateado a Damas, igual que primera_coronacion).
  const u3 = baseUser();
  const ctx3 = buildContext({ user: u3, game: 'chess', outcome: 'win', opponentElo: 1200, moveCount: 0, endedAt: new Date(), justMultiCapture: true });
  const unlocked3 = checkNewAchievements(u3, ctx3);
  assert(!unlocked3.includes('captura_multiple'), 'captura_multiple NO deberia poder desbloquearse desde Ajedrez');
  console.log('achievements: "captura_multiple" esta gateado a Damas -- Ajedrez nunca lo desbloquea aunque justMultiCapture sea true.');

  // Ya desbloqueado -> no se repite.
  const u4 = baseUser();
  u4.achievements = [{ key: 'captura_multiple', unlockedAt: new Date() }];
  const ctx4 = buildContext({ user: u4, game: 'damas', outcome: 'win', opponentElo: 1200, moveCount: 0, endedAt: new Date(), justMultiCapture: true });
  const unlocked4 = checkNewAchievements(u4, ctx4);
  assert(!unlocked4.includes('captura_multiple'), 'un logro ya desbloqueado no deberia volver a aparecer en checkNewAchievements');
  console.log('achievements: ya desbloqueado, no vuelve a aparecer como "nuevo" en una partida siguiente.');
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer(baseUrl, proc, lines) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited early with code ${proc.exitCode}\n${lines.join('\n')}`);
    try {
      const res = await fetch(`${baseUrl}/api/health/db`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {}
    await wait(500);
  }
  throw new Error(`server did not become ready. logs:\n${lines.join('\n')}`);
}

async function verifyEndpointExposesIt() {
  const port = Number(process.env.OZAMA_MULTICAPTURE_TEST_PORT || 3226);
  const baseUrl = `http://127.0.0.1:${port}`;
  const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_mcap' });

  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'multicapture-flow-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));
  proc.stderr.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));

  try {
    await waitForServer(baseUrl, proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `mcapU_${suffix}`, email: `mcapu_${suffix}@example.test`, password: 'CorrectHorse99!', country: 'DO' }),
    });
    const reg = await regRes.json();
    assert(regRes.status === 201, `register -> ${regRes.status} ${JSON.stringify(reg)}`);

    const achvRes = await fetch(`${baseUrl}/api/user/achievements`, { headers: { Authorization: `Bearer ${reg.token}` } });
    const achvData = await achvRes.json();
    assert(achvRes.status === 200, `GET /achievements -> ${achvRes.status}`);
    const entry = achvData.achievements.find((a) => a.key === 'captura_multiple');
    assert(entry, '"captura_multiple" deberia aparecer en GET /api/user/achievements');
    assert(entry.unlocked === false, `un usuario nuevo no deberia tenerlo desbloqueado, vino ${JSON.stringify(entry)}`);
    assert(entry.progress === null, `es un evento puntual, progress deberia ser null (no un contador fabricado), vino ${JSON.stringify(entry.progress)}`);
    assert(entry.rarity === 'poco-comun', `rarity deberia ser 'poco-comun', vino ${entry.rarity}`);
    console.log('endpoint: GET /api/user/achievements expone "captura_multiple" (bloqueado, sin progreso fabricado) para un usuario nuevo.');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

async function main() {
  verifyEngineProducesTripleCapture();
  verifyAchievementLogic();
  await verifyEndpointExposesIt();
  console.log('\n✅ MULTICAPTURE_ACHIEVEMENT_OK');
}

main().catch((err) => {
  console.error('\n❌ MULTICAPTURE_ACHIEVEMENT_FAILED:', err.message);
  process.exit(1);
});
