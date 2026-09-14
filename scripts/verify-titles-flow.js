'use strict';

// Prueba de punta a punta de "Titulos y Rangos" (Fase 9 del roadmap
// "OZAMA PRO"): auditoria previa encontro que la escalera automatica
// por nivel YA existia (services/titles.js, titleForLevel) y el rango
// por ELO por juego tambien (rankTier en routes/user.js) -- lo que
// faltaba eran los "titulos especiales obtenibles mediante torneos,
// temporadas, logros, rendimiento" que el roadmap pide explicitamente,
// equipables como un marco de perfil. Verifica, contra un server.js
// real y una Mongo aislada y temporal (nunca produccion):
//
//   - GET /api/user/titles arranca con todo bloqueado (menos el
//     automatico, siempre disponible);
//   - equipar un titulo bloqueado se rechaza con 403;
//   - al desbloquear el logro correspondiente, el titulo aparece
//     unlocked=true y se puede equipar;
//   - equipar un titulo especial CAMBIA el globalTitle que devuelven
//     /me Y el perfil publico -- sin tocar el ELO de nadie (pedido
//     explicito del roadmap: "El ELO continua siendo independiente");
//   - volver a "ninguno" restaura el titulo automatico por nivel de
//     siempre, sin romper nada de lo que ya funcionaba.
//
// Uso: node scripts/verify-titles-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_TITLES_TEST_PORT || 3222);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_titles' });

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

async function patchJson(path, body, token) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
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
      JWT_SECRET: process.env.JWT_SECRET || 'titles-flow-test-secret-at-least-32-chars',
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

  try {
    await waitForServer(proc, serverLines);
    await connectDatabase();
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const reg = await register(`titlesU_${suffix}`);
    const token = reg.token;
    const userId = reg.user.id;
    const eloBefore = reg.user.elo;

    // ═══════ Arranca todo bloqueado salvo el automatico ═══════
    const listBefore = await getJson('/api/user/titles', token);
    assert(listBefore.status === 200, `GET /titles -> ${listBefore.status}`);
    assert(listBefore.data.titles.length === 6, `deberian ser 6 titulos especiales en el catalogo, vino ${listBefore.data.titles.length}`);
    assert(listBefore.data.titles.every((t) => !t.unlocked), 'un usuario nuevo no deberia tener NINGUN titulo especial desbloqueado');
    assert(listBefore.data.titles.every((t) => !t.equipped), 'ninguno deberia estar equipado (usa el automatico por defecto)');
    console.log('titles: usuario nuevo arranca con los 6 titulos especiales bloqueados.');

    const meBefore = await getJson('/api/user/me', token);
    assert(meBefore.data.user.globalTitle === 'Novato', `un usuario nuevo (nivel 1) deberia mostrar "Novato" automatico, vino "${meBefore.data.user.globalTitle}"`);
    console.log(`titles: sin nada equipado, globalTitle es el automatico por nivel ("${meBefore.data.user.globalTitle}").`);

    // ═══════ Equipar uno bloqueado se rechaza ═══════
    const blockedEquip = await patchJson('/api/user/titles/campeon_torneo', {}, token);
    assert(blockedEquip.status === 403, `equipar un titulo bloqueado deberia dar 403, vino ${blockedEquip.status}`);
    console.log('titles: equipar un titulo todavia bloqueado se rechaza con 403.');

    // ═══════ Desbloquear el logro correspondiente ═══════
    // Se otorga directo via el modelo (igual que server.js lo hace
    // desde handleTournamentMatchFinished) -- no hace falta jugar un
    // torneo entero para probar el endpoint de titulos en si.
    const user = await User.findById(userId);
    user.achievements = [...(user.achievements || []), { key: 'campeon_torneo', unlockedAt: new Date() }];
    await user.save();

    const listAfter = await getJson('/api/user/titles', token);
    const champTitle = listAfter.data.titles.find((t) => t.key === 'campeon_torneo');
    assert(champTitle?.unlocked, `tras el logro, "campeon_torneo" deberia aparecer unlocked=true, vino ${JSON.stringify(champTitle)}`);
    console.log('titles: al desbloquear el logro, el titulo especial aparece disponible.');

    // ═══════ Equiparlo cambia el globalTitle (ELO intacto) ═══════
    const equipRes = await patchJson('/api/user/titles/campeon_torneo', {}, token);
    assert(equipRes.status === 200 && equipRes.data.equippedTitle === 'campeon_torneo', `equipar deberia dar 200 con equippedTitle, vino ${JSON.stringify(equipRes.data)}`);

    const meAfter = await getJson('/api/user/me', token);
    assert(meAfter.data.user.globalTitle === 'Campeón de Torneo', `globalTitle deberia ser el especial equipado, vino "${meAfter.data.user.globalTitle}"`);
    assert(meAfter.data.user.elo === eloBefore, `el ELO NO deberia cambiar por equipar un titulo (pedido explicito del roadmap), antes ${eloBefore} ahora ${meAfter.data.user.elo}`);
    console.log(`titles: equipar "Campeón de Torneo" cambia el globalTitle mostrado, ELO intacto (${meAfter.data.user.elo}).`);

    // El perfil PUBLICO tambien debe reflejarlo (no solo /me).
    const publicProfile = await getJson(`/api/user/${reg.user.username}`);
    assert(publicProfile.data.user.globalTitle === 'Campeón de Torneo', `el perfil publico deberia mostrar el titulo equipado, vino "${publicProfile.data.user.globalTitle}"`);
    console.log('titles: el perfil publico (sin sesion) tambien muestra el titulo especial equipado.');

    // ═══════ Volver a "ninguno" restaura el automatico ═══════
    const revertRes = await patchJson('/api/user/titles/ninguno', {}, token);
    assert(revertRes.status === 200 && revertRes.data.equippedTitle === null, `volver a "ninguno" deberia dar equippedTitle:null, vino ${JSON.stringify(revertRes.data)}`);
    const meReverted = await getJson('/api/user/me', token);
    assert(meReverted.data.user.globalTitle === 'Novato', `tras "ninguno", globalTitle deberia volver al automatico ("Novato"), vino "${meReverted.data.user.globalTitle}"`);
    console.log('titles: "ninguno" restaura el titulo automatico por nivel de siempre.');

    console.log('\n✅ TITLES_FLOW_OK');
  } finally {
    try { await mongoose.disconnect(); } catch (_) {}
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ TITLES_FLOW_FAILED:', err.message);
  process.exit(1);
});
