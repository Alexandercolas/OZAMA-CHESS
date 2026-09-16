'use strict';

// Prueba de "Entrenamiento" (Fase 21 del roadmap "OZAMA PRO"):
// auditoria confirmo que el campo `category` de cada puzzle (mate1/
// fork/pin en Ajedrez, captura/captura-multiple/coronacion en Damas)
// existia en el catalogo desde el principio pero training.html/
// damas-training.html nunca lo mostraban ni dejaban elegir practicar
// una tactica especifica -- "Practica libre" era siempre TODO el
// catalogo mezclado. Se agrega GET /api/puzzles/categories (+ su
// espejo de Damas) y `category` como filtro opcional de
// /api/puzzles/practice, reusando exactamente la misma logica de
// dificultad/repeticion (nextPracticePuzzle) que ya existia.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion), para los DOS juegos:
//
//   - GET /categories devuelve las categorias reales del catalogo
//     (derivadas de PUZZLES, nunca una lista aparte);
//   - GET /practice?category=X devuelve SOLO un puzzle de esa
//     categoria;
//   - un valor de categoria invalido/inventado se ignora (se
//     comporta como sin filtro, nunca un 500 ni un puzzle inventado);
//   - practicar una categoria especifica sigue respetando "el mas
//     facil que no resolvio" (mismo criterio de siempre) DENTRO de
//     esa categoria.
//
// Uso: node scripts/verify-puzzle-categories.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_PUZZLE_CAT_TEST_PORT || 3232);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_pzcat' });

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

async function checkGame(label, prefix, token, expectedCategoryKeys) {
  const catRes = await getJson(`/api/${prefix}/categories`);
  assert(catRes.status === 200, `${label}: GET /${prefix}/categories -> ${catRes.status}`);
  const gotKeys = catRes.data.categories.map((c) => c.key).sort();
  assert(JSON.stringify(gotKeys) === JSON.stringify([...expectedCategoryKeys].sort()),
    `${label}: categorias esperadas ${JSON.stringify(expectedCategoryKeys)}, vino ${JSON.stringify(gotKeys)}`);
  assert(catRes.data.categories.every((c) => typeof c.label === 'string' && c.label.length > 0),
    `${label}: cada categoria deberia traer un label legible, vino ${JSON.stringify(catRes.data.categories)}`);
  console.log(`${label}: GET /categories devuelve exactamente las categorias del catalogo real: ${gotKeys.join(', ')}.`);

  // Practicar CADA categoria real -- el puzzle devuelto debe ser
  // siempre de esa categoria, nunca de otra.
  for (const key of expectedCategoryKeys) {
    const res = await getJson(`/api/${prefix}/practice?category=${encodeURIComponent(key)}`, token);
    assert(res.status === 200, `${label}: GET /practice?category=${key} -> ${res.status}`);
    assert(res.data.puzzle?.category === key, `${label}: practicar "${key}" deberia devolver un puzzle de esa categoria, vino ${JSON.stringify(res.data.puzzle)}`);
  }
  console.log(`${label}: practicar cada categoria real devuelve SIEMPRE un puzzle de esa categoria.`);

  // Categoria inventada -- se ignora (se comporta como sin filtro),
  // nunca un 500 ni un puzzle con categoria inventada.
  const bogusRes = await getJson('/api/' + prefix + '/practice?category=no-existe-esta-categoria', token);
  assert(bogusRes.status === 200, `${label}: una categoria invalida NO deberia romper el endpoint, vino ${bogusRes.status}`);
  assert(expectedCategoryKeys.includes(bogusRes.data.puzzle?.category), `${label}: con categoria invalida deberia devolver un puzzle real de alguna categoria del catalogo, vino ${JSON.stringify(bogusRes.data.puzzle)}`);
  console.log(`${label}: una categoria invalida se ignora (se comporta como sin filtro), nunca rompe.`);

  // Sin filtro -- sigue funcionando igual que siempre.
  const allRes = await getJson(`/api/${prefix}/practice`, token);
  assert(allRes.status === 200 && allRes.data.puzzle, `${label}: /practice sin filtro deberia seguir funcionando, vino ${JSON.stringify(allRes.data)}`);
  console.log(`${label}: /practice sin filtro (comportamiento de siempre) sigue funcionando.`);
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'puzzle-cat-flow-test-secret-at-least-32-char',
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
    const reg = await register(`pzcatU_${suffix}`);

    await checkGame('Ajedrez', 'puzzles', reg.token, ['mate1', 'fork', 'pin']);
    await checkGame('Damas', 'damas-puzzles', reg.token, ['captura', 'captura-multiple', 'coronacion']);

    console.log('\n✅ PUZZLE_CATEGORIES_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ PUZZLE_CATEGORIES_FAILED:', err.message);
  process.exit(1);
});
