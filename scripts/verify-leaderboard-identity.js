'use strict';

// Prueba de "Ranking" (Fase 23 del roadmap "OZAMA PRO"): auditoria
// encontro que el ranking (la pagina MAS publica y competitiva de
// toda la app) nunca mostraba nivel/titulo/marco de perfil -- todo eso
// ya existia y se mostraba en player.html a un click de distancia, el
// ranking solo tenia username/pais/ELO/W-D-L. De paso, se encontro que
// "Marco de Temporada" (el marco mas raro de todos, legendario, solo
// para quien termina #1 en el ranking de una temporada completa)
// nunca tenia una regla CSS en NINGUNA pagina -- se equipaba sin
// problema pero jamas se veia.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion):
//
//   - GET /api/user/leaderboard incluye globalTitle real (calculado
//     con la MISMA logica que usa el perfil publico: automatico por
//     nivel, o el titulo especial equipado si sigue desbloqueado) y
//     equippedFrame para cada jugador del top 20;
//   - equipar un titulo especial (via el mismo flujo real de
//     PATCH /titles/:key que ya prueba verify-titles-flow.js) cambia
//     el globalTitle mostrado en el RANKING tambien, no solo en el
//     perfil -- ambos leen la misma fuente de verdad
//     (resolveGlobalTitle);
//   - el ranking NUNCA expone xp/achievements en crudo (se calculan
//     server-side y se descartan, igual que ya se probaba para
//     email/lastSeenAt en tests/readiness.test.js).
//
// Uso: node scripts/verify-leaderboard-identity.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_LEADERBOARD_ID_TEST_PORT || 3234);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_lbid' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

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

async function patchJson(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
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

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'leaderboard-id-flow-test-secret-at-least-32-c',
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
    await waitForServer(proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const reg = await register(`lbidU_${suffix}`);
    const token = reg.token;
    const userId = reg.user.id;

    // ═══════ El ranking ya incluye globalTitle y equippedFrame para un usuario nuevo ═══════
    const rawRes = await fetch(`${baseUrl}/api/user/leaderboard`);
    const raw = await rawRes.json();
    assert(rawRes.status === 200, `GET /leaderboard -> ${rawRes.status}`);
    const me = raw.players.find((p) => p.username === reg.user.username);
    assert(me, `deberia aparecer en el top 20 (base de prueba chica), vino ${JSON.stringify(raw.players.map((p) => p.username))}`);
    assert(me.globalTitle === 'Novato', `un usuario nuevo (nivel 1) deberia mostrar "Novato" en el ranking, vino "${me.globalTitle}"`);
    assert('equippedFrame' in me, 'el ranking deberia traer equippedFrame para poder pintar el marco del avatar');
    assert(!('xp' in me) && !('achievements' in me), `el ranking NUNCA deberia exponer xp/achievements en crudo, vino ${JSON.stringify(Object.keys(me))}`);
    console.log('leaderboard: un usuario nuevo aparece con globalTitle="Novato" y equippedFrame, sin exponer xp/achievements en crudo.');

    // ═══════ Desbloquear + equipar un titulo especial cambia el ranking tambien ═══════
    const { default: mongoose } = await import('mongoose').then((m) => ({ default: m.default || m }));
    process.env.MONGODB_URI = isolatedMongo.env.MONGODB_URI;
    process.env.MONGODB_DB_NAME = isolatedMongo.env.MONGODB_DB_NAME;
    const connectDatabase = require('../config/database');
    const User = require('../models/User');
    await connectDatabase();

    const user = await User.findById(userId);
    user.achievements = [...(user.achievements || []), { key: 'campeon_torneo', unlockedAt: new Date() }];
    await user.save();

    const equipRes = await patchJson('/api/user/titles/campeon_torneo', {}, token);
    assert(equipRes.status === 200 && equipRes.data.equippedTitle === 'campeon_torneo', `equipar deberia dar 200, vino ${JSON.stringify(equipRes.data)}`);

    const afterRes = await fetch(`${baseUrl}/api/user/leaderboard`);
    const after = await afterRes.json();
    const meAfter = after.players.find((p) => p.username === reg.user.username);
    assert(meAfter.globalTitle === 'Campeón de Torneo', `tras equipar el titulo especial, el RANKING deberia mostrarlo tambien, vino "${meAfter.globalTitle}"`);
    console.log('leaderboard: equipar un titulo especial se refleja en el ranking (misma fuente de verdad que el perfil publico).');

    await mongoose.disconnect();

    console.log('\n✅ LEADERBOARD_IDENTITY_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ LEADERBOARD_IDENTITY_FAILED:', err.message);
  process.exit(1);
});
