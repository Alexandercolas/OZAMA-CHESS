'use strict';

// Prueba de punta a punta de "Recompensas" (Fase 12) + "Misiones"
// (Fase 13) del roadmap "OZAMA PRO": auditoria previa encontro que el
// otorgamiento de XP/logros ya estaba unificado en un solo lugar
// (services/rewards.js) para torneos (server.js) y temporadas
// (services/seasons.js) -- el hueco concreto era Misiones: GET
// /api/user/weekly-challenges (services/weeklyChallenges.js) YA
// calculaba el progreso real de los retos semanales, pero nunca
// otorgaba ningun XP al completarse, a diferencia de todas las demas
// fuentes de recompensa; y el reto de puzzles quedaba afuera del todo
// por falta de un contador semanal real. Este script verifica, contra
// un server.js real y una Mongo aislada y temporal (nunca produccion):
//
//   - completar un reto semanal (partidas reales insertadas dentro de
//     la ventana de la semana actual) otorga el bono de XP la PRIMERA
//     vez que se pide GET /weekly-challenges;
//   - pedirlo de nuevo NO vuelve a otorgar el mismo XP (idempotente,
//     via claimedKeys en el propio usuario);
//   - el reto devuelve claimed:true una vez otorgado;
//   - un reto que no se completo no otorga nada y no aparece claimed;
//   - resolver puzzles de verdad (POST /api/puzzles/:key/solve) suma
//     al contador semanal (User.weeklyPuzzlesSolved) y completa/otorga
//     el reto "Resuelve 3 Acertijos" igual que los demas.
//
// Uso: node scripts/verify-weekly-rewards-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_WEEKLY_TEST_PORT || 3225);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_weekly' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForServer(proc, lines) {
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

async function postJson(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function getJson(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function register(username) {
  const res = await postJson('/api/auth/register', {
    username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO',
  });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'weekly-rewards-flow-test-secret-at-least-32-chars',
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

  process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
  process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
  const mongoose = require('mongoose');
  const connectDatabase = require('../config/database');
  const User = require('../models/User');
  const Match = require('../models/Match');

  try {
    await waitForServer(proc, serverLines);
    await connectDatabase();
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const reg = await register(`weeklyU_${suffix}`);
    const token = reg.token;
    const userId = reg.user.id;
    const xpBefore = reg.user.xp || 0;

    // ═══════ Sin partidas todavia: nada completado, nada otorgado ═══════
    const before = await getJson('/api/user/weekly-challenges', token);
    assert(before.status === 200, `GET /weekly-challenges -> ${before.status}`);
    assert(before.data.challenges.length === 4, `deberian ser 4 retos, vino ${before.data.challenges.length}`);
    assert(before.data.challenges.every((c) => !c.completed && !c.claimed), 'un usuario nuevo sin partidas no deberia tener ningun reto completado');
    console.log('weekly: sin partidas ni puzzles esta semana, los 4 retos arrancan sin completar.');

    // ═══════ Insertar 3 victorias esta semana (cumple "gana_3" Y "juega_5" NO, target 5) ═══════
    const now = new Date();
    const opponent = { userId: null, name: 'CPU', country: 'DO', avatar: 0, elo: 1200 };
    const wins = [1, 2, 3].map((i) => ({
      roomCode: `WKTEST${suffix}${i}`,
      whitePlayer: { userId, name: reg.user.username, country: 'DO', avatar: 0, elo: 1200 },
      blackPlayer: opponent,
      result: 'white_win',
      winner: 'w',
      startedAt: now,
      endedAt: now,
    }));
    await Match.insertMany(wins);

    const afterWins = await getJson('/api/user/weekly-challenges', token);
    const gana3 = afterWins.data.challenges.find((c) => c.key === 'gana_3');
    const juega5 = afterWins.data.challenges.find((c) => c.key === 'juega_5');
    assert(gana3.completed && gana3.claimed, `gana_3 deberia estar completado y reclamado con 3 victorias, vino ${JSON.stringify(gana3)}`);
    assert(!juega5.completed && !juega5.claimed, `juega_5 (objetivo 5) NO deberia estar completo con solo 3 partidas, vino ${JSON.stringify(juega5)}`);
    console.log(`weekly: "Gana 3 Partidas" se completa y se reclama solo (+${gana3.xp} XP), "Juega 5 Partidas" sigue en progreso.`);

    const userAfterWins = await User.findById(userId).select('xp weeklyChallenges');
    assert(userAfterWins.xp === xpBefore + gana3.xp, `el XP del usuario deberia subir exactamente ${gana3.xp}, antes ${xpBefore} ahora ${userAfterWins.xp}`);
    assert((userAfterWins.weeklyChallenges?.claimedKeys || []).includes('gana_3'), 'gana_3 deberia quedar en claimedKeys del usuario');
    console.log(`weekly: el XP se sumo una sola vez en el documento del usuario (${userAfterWins.xp}).`);

    // ═══════ Pedirlo de nuevo NO vuelve a otorgar el mismo XP ═══════
    const again = await getJson('/api/user/weekly-challenges', token);
    const gana3Again = again.data.challenges.find((c) => c.key === 'gana_3');
    assert(gana3Again.completed && gana3Again.claimed, 'gana_3 deberia seguir completado/reclamado en una segunda lectura');
    const userAfterSecondRead = await User.findById(userId).select('xp');
    assert(userAfterSecondRead.xp === userAfterWins.xp, `una segunda lectura NO deberia volver a sumar XP, antes ${userAfterWins.xp} ahora ${userAfterSecondRead.xp}`);
    console.log('weekly: pedir el progreso de nuevo no vuelve a otorgar el XP ya reclamado (idempotente).');

    // ═══════ Completar tambien "Juega 5 Partidas" con 2 partidas mas ═══════
    const moreGames = [4, 5].map((i) => ({
      roomCode: `WKTEST${suffix}${i}`,
      whitePlayer: { userId, name: reg.user.username, country: 'DO', avatar: 0, elo: 1200 },
      blackPlayer: opponent,
      result: 'black_win',
      winner: 'b',
      startedAt: now,
      endedAt: now,
    }));
    await Match.insertMany(moreGames);

    const afterFive = await getJson('/api/user/weekly-challenges', token);
    const juega5After = afterFive.data.challenges.find((c) => c.key === 'juega_5');
    assert(juega5After.completed && juega5After.claimed, `juega_5 deberia completarse al llegar a 5 partidas jugadas, vino ${JSON.stringify(juega5After)}`);
    const userFinal = await User.findById(userId).select('xp weeklyChallenges');
    assert(userFinal.xp === userAfterWins.xp + juega5After.xp, `el XP deberia subir exactamente lo de juega_5 (${juega5After.xp}) sin tocar lo de gana_3, antes ${userAfterWins.xp} ahora ${userFinal.xp}`);
    assert((userFinal.weeklyChallenges.claimedKeys || []).sort().join(',') === ['gana_3', 'juega_5'].sort().join(','), `claimedKeys deberia tener exactamente gana_3 y juega_5, vino ${JSON.stringify(userFinal.weeklyChallenges.claimedKeys)}`);
    console.log(`weekly: completar un segundo reto ("Juega 5 Partidas") otorga solo SU propio XP, sin duplicar el de "Gana 3".`);

    // ═══════ Resolver 3 puzzles reales completa "Resuelve 3 Acertijos" ═══════
    const puzzleSolves = [
      { key: 'mate1-backrank', moves: [{ from: 'd1', to: 'd8' }] },
      { key: 'mate1-smothered', moves: [{ from: 'd6', to: 'f7' }] },
      { key: 'mate1-queen-support', moves: [{ from: 'h1', to: 'h7' }] },
    ];
    let puzzleSolveXp = 0;
    for (const p of puzzleSolves) {
      const solveRes = await postJson(`/api/puzzles/${p.key}/solve`, { moves: p.moves, mode: 'practice' }, token);
      assert(solveRes.status === 200 && solveRes.data.correct === true, `resolver ${p.key} deberia dar correct:true, vino ${JSON.stringify(solveRes.data)}`);
      puzzleSolveXp += solveRes.data.xpGained;
    }
    console.log(`weekly: se resolvieron 3 puzzles reales via POST /api/puzzles/:key/solve (+${puzzleSolveXp} XP de los puzzles en si).`);

    const afterPuzzles = await getJson('/api/user/weekly-challenges', token);
    const puzzleChallenge = afterPuzzles.data.challenges.find((c) => c.key === 'resuelve_puzzles');
    assert(puzzleChallenge.current === 3 && puzzleChallenge.completed && puzzleChallenge.claimed, `"Resuelve 3 Acertijos" deberia completarse y reclamarse tras 3 puzzles, vino ${JSON.stringify(puzzleChallenge)}`);
    const userAfterPuzzles = await User.findById(userId).select('xp weeklyPuzzlesSolved weeklyChallenges');
    assert(userAfterPuzzles.weeklyPuzzlesSolved.count === 3, `weeklyPuzzlesSolved.count deberia ser 3, vino ${userAfterPuzzles.weeklyPuzzlesSolved.count}`);
    assert(userAfterPuzzles.xp === userFinal.xp + puzzleSolveXp + puzzleChallenge.xp, `el XP deberia subir lo de los puzzles (${puzzleSolveXp}) mas el bono del reto (${puzzleChallenge.xp}), antes ${userFinal.xp} ahora ${userAfterPuzzles.xp}`);
    console.log(`weekly: "Resuelve 3 Acertijos" se completa con puzzles reales (Ajedrez) y otorga +${puzzleChallenge.xp} XP extra por el reto.`);

    // Una segunda lectura no vuelve a otorgar el bono del reto de puzzles.
    const afterPuzzlesAgain = await getJson('/api/user/weekly-challenges', token);
    const userAfterPuzzlesAgain = await User.findById(userId).select('xp');
    assert(userAfterPuzzlesAgain.xp === userAfterPuzzles.xp, `una segunda lectura no deberia volver a otorgar el bono de resuelve_puzzles, antes ${userAfterPuzzles.xp} ahora ${userAfterPuzzlesAgain.xp}`);
    console.log('weekly: el bono de "Resuelve 3 Acertijos" tampoco se duplica en una segunda lectura.');

    console.log('\n✅ WEEKLY_REWARDS_FLOW_OK');
  } finally {
    try { await mongoose.disconnect(); } catch (_) {}
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ WEEKLY_REWARDS_FLOW_FAILED:', err.message);
  process.exit(1);
});
