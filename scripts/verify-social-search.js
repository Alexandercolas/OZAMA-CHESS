'use strict';

// Prueba de punta a punta de dos piezas de Fase 6 ("Sistema Social")
// contra un server.js real y una Mongo aislada y temporal (nunca
// produccion):
//
//   - GET /api/user/search?q= -- "busqueda de jugadores", nueva; trae
//     coincidencias por prefijo de username, vacio si el texto es muy
//     corto, vacio (no error) si nadie coincide;
//   - GET /api/user/:username ahora tambien devuelve isFriend -- antes
//     player.html no tenia forma de saber si ya eran amigos (por eso
//     nunca mostraba el boton de "Agregar/Quitar amigo" ahi, aunque el
//     API de amigos ya funcionaba desde el lobby). Se verifica que
//     isFriend refleja de verdad el estado (false -> agregar -> true
//     -> quitar -> false), simetrico para ambos lados de la amistad.
//
// Uso: node scripts/verify-social-search.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_SOCIAL_TEST_PORT || 3177);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_social' });

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

async function deleteJson(path, token) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
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
      JWT_SECRET: process.env.JWT_SECRET || 'social-search-test-secret-at-least-32-chars',
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
    const prefix = `social${suffix}`;
    const a = await register(`${prefix}A`);
    const b = await register(`${prefix}B`);
    const other = await register(`unrelated_${suffix}`);
    console.log(`Registrados: A=${a.user.username}, B=${b.user.username}, otro=${other.user.username}`);

    // ── Busqueda de jugadores ─────────────────────────────────────
    const short = await getJson('/api/user/search?q=a');
    assert(short.status === 200 && Array.isArray(short.data.users) && short.data.users.length === 0, `busqueda de 1 caracter deberia devolver vacio, vino ${JSON.stringify(short.data)}`);
    console.log('Busqueda: texto de 1 caracter -> vacio (sin error).');

    const matches = await getJson(`/api/user/search?q=${encodeURIComponent(prefix)}`);
    assert(matches.status === 200, `search -> ${matches.status} ${JSON.stringify(matches.data)}`);
    const foundNames = matches.data.users.map((u) => u.username);
    assert(foundNames.includes(a.user.username) && foundNames.includes(b.user.username), `deberia encontrar a A y B por prefijo, vino ${JSON.stringify(foundNames)}`);
    assert(!foundNames.includes(other.user.username), 'no deberia encontrar a un usuario que no matchea el prefijo');
    console.log(`Busqueda: "${prefix}" encuentra A y B (y no a un tercero sin relacion).`);

    const noMatch = await getJson(`/api/user/search?q=zzzzznomatch${suffix}`);
    assert(noMatch.status === 200 && noMatch.data.users.length === 0, 'una busqueda sin coincidencias deberia devolver un array vacio, no error');
    console.log('Busqueda: sin coincidencias -> array vacio (no error).');

    // ── isFriend en el perfil publico ────────────────────────────
    const profileBefore = await getJson(`/api/user/${b.user.username}`, a.token);
    assert(profileBefore.data.isFriend === false, `antes de agregar, isFriend deberia ser false, vino ${profileBefore.data.isFriend}`);
    console.log('Perfil publico: isFriend=false antes de agregar.');

    const addRes = await postJson(`/api/user/friends/${b.user.username}`, {}, a.token);
    assert(addRes.status === 200, `agregar amigo -> ${addRes.status} ${JSON.stringify(addRes.data)}`);

    const profileAfterA = await getJson(`/api/user/${b.user.username}`, a.token);
    assert(profileAfterA.data.isFriend === true, `desde A, isFriend deberia ser true, vino ${profileAfterA.data.isFriend}`);
    const profileAfterB = await getJson(`/api/user/${a.user.username}`, b.token);
    assert(profileAfterB.data.isFriend === true, `la amistad es simetrica -- desde B tambien deberia ser true, vino ${profileAfterB.data.isFriend}`);
    console.log('Perfil publico: isFriend=true para AMBOS lados tras agregar (simetrico).');

    const removeRes = await deleteJson(`/api/user/friends/${b.user.username}`, a.token);
    assert(removeRes.status === 200, `quitar amigo -> ${removeRes.status} ${JSON.stringify(removeRes.data)}`);
    const profileAfterRemove = await getJson(`/api/user/${b.user.username}`, a.token);
    assert(profileAfterRemove.data.isFriend === false, `tras quitar, isFriend deberia volver a false, vino ${profileAfterRemove.data.isFriend}`);
    console.log('Perfil publico: isFriend=false tras quitar amigo.');

    console.log('\n✅ SOCIAL_SEARCH_FLOW_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ SOCIAL_SEARCH_FLOW_FAILED:', err.message);
  process.exit(1);
});
