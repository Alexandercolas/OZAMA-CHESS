'use strict';

// Prueba de punta a punta de "Mejor ELO" (Fase 5, "Perfil Competitivo"):
// antes de esta fase no se trackeaba el pico de ELO de siempre de nadie
// (solo el ELO en vivo y streak/bestStreak). Verifica, contra un
// server.js real y una Mongo aislada y temporal (nunca produccion):
//
//   - User.updateElo()/updateDamasElo() actualizan stats.bestElo /
//     damasStats.bestElo SOLO cuando el ELO nuevo supera al pico
//     anterior, y NUNCA bajan el pico ante una derrota;
//   - scripts/backfill-best-elo.js reconstruye el pico historico de un
//     usuario que ya tenia partidas guardadas de ANTES de este cambio
//     (bestElo todavia en el default), tomando el maximo entre su ELO
//     en vivo de hoy y lo mas alto visto en su historial;
//   - GET /api/user/elo-history?game=chess -- el fix del orden de
//     ordenamiento (antes traia las 200 mas VIEJAS, ahora las 200 mas
//     RECIENTES) -- con mas de 200 partidas guardadas, la ultima
//     entrada del historial devuelto debe ser la partida mas reciente,
//     no la #200 de siempre.
//
// Uso: node scripts/verify-profile-stats.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_PROFILE_STATS_TEST_PORT || 3166);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_profstat' });

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

function runNodeScript(scriptPath, args, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [scriptPath, ...args], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = [];
    proc.stdout.on('data', (c) => lines.push(...c.toString().trim().split(/\r?\n/)));
    proc.stderr.on('data', (c) => lines.push(...c.toString().trim().split(/\r?\n/)));
    proc.on('exit', (code) => {
      if (code === 0) resolve(lines.join('\n'));
      else reject(new Error(`${scriptPath} exited with code ${code}\n${lines.join('\n')}`));
    });
  });
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'profile-stats-test-secret-at-least-32-chars',
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

  // Conexion Mongoose propia de este script (a la MISMA base aislada)
  // para poder manipular documentos directamente -- separada de la
  // conexion del server.js hijo, ambas contra el mismo Atlas temporal.
  process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
  process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
  const mongoose = require('mongoose');
  const connectDatabase = require('../config/database');
  const User = require('../models/User');
  const Match = require('../models/Match');
  const DamasMatch = require('../models/DamasMatch');

  try {
    await waitForServer(proc, serverLines);
    await connectDatabase();
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);

    // ═══════ Parte A: updateElo()/updateDamasElo() trackean el pico ═══════
    const regA = await register(`pstatA_${suffix}`);
    const userA = await User.findById(regA.user.id);
    assert(userA.stats.bestElo === 1200, `bestElo deberia arrancar en 1200 (ELO inicial), vino ${userA.stats.bestElo}`);

    userA.updateElo(1200, 1); // gana -> elo sube
    const eloAfterWin = userA.elo;
    assert(userA.stats.bestElo === eloAfterWin, `tras ganar, bestElo deberia igualar el nuevo ELO (${eloAfterWin}), vino ${userA.stats.bestElo}`);
    console.log(`Ajedrez: gana -> elo=${eloAfterWin}, bestElo=${userA.stats.bestElo} (igual, OK).`);

    userA.updateElo(eloAfterWin + 50, 0); // pierde contra alguien mas fuerte -> elo baja
    const eloAfterLoss = userA.elo;
    assert(eloAfterLoss < eloAfterWin, `tras perder, el elo deberia bajar (antes ${eloAfterWin}, ahora ${eloAfterLoss})`);
    assert(userA.stats.bestElo === eloAfterWin, `tras perder, bestElo NO deberia bajar (deberia seguir en ${eloAfterWin}), vino ${userA.stats.bestElo}`);
    console.log(`Ajedrez: pierde -> elo=${eloAfterLoss} (bajo), bestElo sigue en ${userA.stats.bestElo} (no bajo, OK).`);

    userA.updateDamasElo(1200, 1);
    assert(userA.damasStats.bestElo === userA.damasElo, 'damasStats.bestElo deberia trackear damasElo igual que en ajedrez');
    console.log(`Damas: gana -> damasElo=${userA.damasElo}, damasStats.bestElo=${userA.damasStats.bestElo} (igual, OK).`);
    await userA.save();

    // ═══════ Parte B: backfill-best-elo.js reconstruye el historico ═══════
    const regB = await register(`pstatB_${suffix}`);
    const userB = await User.findById(regB.user.id);
    assert(userB.stats.bestElo === 1200 && userB.damasStats.bestElo === 1200, 'usuario B deberia arrancar con bestElo default (simula cuenta de antes de esta fase)');

    // Partidas viejas de ajedrez con un pico de 1450 (por encima de su
    // ELO en vivo actual, 1200) -- simula que B llego a subir mucho ELO
    // en el pasado y despues volvio a bajar, sin que nada lo recordara.
    const dummyOpponent = new mongoose.Types.ObjectId();
    await Match.create([
      { roomCode: 'BFIL1', whitePlayer: { userId: userB._id, name: 'B', elo: 1350 }, blackPlayer: { userId: dummyOpponent, name: 'Rival', elo: 1300 }, result: 'white_win', eloChange: { white: 150, black: -20 }, endedAt: new Date(Date.now() - 100000) },
      { roomCode: 'BFIL2', whitePlayer: { userId: userB._id, name: 'B', elo: 1450 }, blackPlayer: { userId: dummyOpponent, name: 'Rival', elo: 1280 }, result: 'white_win', eloChange: { white: 100, black: -20 }, endedAt: new Date(Date.now() - 50000) },
    ]);
    // Damas guarda el ELO de ANTES + eloChange (no el de despues como
    // ajedrez) -- ver el comentario en el propio backfill-best-elo.js.
    await DamasMatch.create([
      { roomCode: 'BFIL3', whitePlayer: { userId: userB._id, name: 'B', elo: 1200 }, blackPlayer: { userId: dummyOpponent, name: 'Rival', elo: 1200 }, result: 'white_win', reason: 'no-pieces', eloChange: { white: 220, black: -20 }, endedAt: new Date(Date.now() - 30000) },
    ]);

    const backfillEnv = { ...process.env, ...isolatedMongo.env };
    const dryRunOutput = await runNodeScript('scripts/backfill-best-elo.js', [], backfillEnv);
    assert(!/\[backfill\] \d+ usuario\(s\) actualizados\./.test(dryRunOutput), `un dry-run (sin --confirm) NO deberia decir "actualizados", salida:\n${dryRunOutput}`);
    console.log('backfill-best-elo.js (dry-run): no aplico cambios, solo mostro la vista previa.');

    await runNodeScript('scripts/backfill-best-elo.js', ['--confirm'], backfillEnv);
    const userBAfter = await User.findById(userB._id);
    assert(userBAfter.stats.bestElo === 1450, `bestElo de ajedrez deberia reconstruirse a 1450 (el pico de sus partidas viejas), vino ${userBAfter.stats.bestElo}`);
    assert(userBAfter.damasStats.bestElo === 1420, `damasStats.bestElo deberia ser 1200+220=1420, vino ${userBAfter.damasStats.bestElo}`);
    console.log(`backfill-best-elo.js --confirm: ajedrez bestElo=${userBAfter.stats.bestElo}, damas bestElo=${userBAfter.damasStats.bestElo} (OK).`);

    // ═══════ Parte C: GET /elo-history trae las partidas RECIENTES ═══════
    const regC = await register(`pstatC_${suffix}`);
    const docs = [];
    const totalMatches = 205;
    for (let i = 0; i < totalMatches; i++) {
      docs.push({
        roomCode: `HIST${String(i).padStart(3, '0')}`,
        whitePlayer: { userId: regC.user.id, name: 'C', elo: 1200 + i }, // sube de a 1 por partida
        blackPlayer: { userId: dummyOpponent, name: 'Rival', elo: 1200 },
        result: 'white_win',
        eloChange: { white: 1, black: -1 },
        endedAt: new Date(Date.now() - (totalMatches - i) * 1000), // estrictamente creciente
      });
    }
    await Match.insertMany(docs);

    const historyRes = await getJson('/api/user/elo-history?game=chess', regC.token);
    assert(historyRes.status === 200, `elo-history -> ${historyRes.status} ${JSON.stringify(historyRes.data)}`);
    const history = historyRes.data.history;
    assert(history.length === 200, `deberia devolver 200 partidas (el limite), vino ${history.length}`);
    const lastElo = history[history.length - 1].elo;
    const expectedLastElo = 1200 + (totalMatches - 1); // la partida MAS RECIENTE (#205), no la #200
    assert(lastElo === expectedLastElo, `la ultima entrada deberia ser la partida MAS RECIENTE (elo=${expectedLastElo}), vino elo=${lastElo} -- si esto falla, el fix del orden de sort se rompio (volvio a traer las 200 mas viejas)`);
    const firstElo = history[0].elo;
    assert(firstElo === 1200 + (totalMatches - 200), `la primera entrada deberia ser la partida #6 (la mas vieja DENTRO de la ventana de 200 recientes), vino elo=${firstElo}`);
    console.log(`elo-history: 200 partidas devueltas, de elo=${firstElo} (mas vieja de la ventana) a elo=${lastElo} (la MAS RECIENTE de las ${totalMatches}) -- fix del sort confirmado.`);

    console.log('\n✅ PROFILE_STATS_FLOW_OK');
  } finally {
    try { await mongoose.disconnect(); } catch (_) {}
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ PROFILE_STATS_FLOW_FAILED:', err.message);
  process.exit(1);
});
