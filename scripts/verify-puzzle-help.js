'use strict';

// Prueba de "Puzzles" (Fase 22 del roadmap "OZAMA PRO"): auditoria
// encontro que trabarse en un puzzle no tenia salida -- sin pista, sin
// solucion, sin forma de pasar a otro puzzle salvo resolverlo bien o
// irse de la pagina ("Siguiente puzzle" solo aparecia DESPUES de
// acertar). Se agrega:
//
//   - GET /api/puzzles/:key/solution (+ espejo de Damas): revela la
//     solucion de un puzzle, requiere sesion -- el cliente decide
//     cuando ofrecerla (tras un par de intentos fallidos), pero el
//     dato en si SIEMPRE viene del servidor (publicPuzzle() nunca la
//     manda de entrada).
//   - `exclude` en /practice: permite "Saltar puzzle" sin marcarlo
//     como resuelto -- el excluido NO se guarda en el perfil, solo se
//     evita en ESA busqueda puntual.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion), para los DOS juegos:
//
//   - GET /:key/solution devuelve la solucion real (coincide
//     exactamente con lo que POST /:key/solve acepta como correcto);
//   - un puzzle inexistente da 404, nunca un 500 ni una solucion
//     inventada;
//   - `exclude=key` en /practice nunca devuelve ESE key (saltar de
//     verdad cambia de puzzle);
//   - saltar un puzzle NO lo marca como resuelto (solvedKeys del
//     usuario sigue igual, GET /stats sigue en 0).
//
// Uso: node scripts/verify-puzzle-help.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_PUZZLE_HELP_TEST_PORT || 3233);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_pzhelp' });

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

async function checkGame(label, prefix, token) {
  // ═══════ GET /:key/solution devuelve la solucion real ═══════
  const first = await getJson(`/api/${prefix}/practice`, token);
  assert(first.status === 200 && first.data.puzzle, `${label}: /practice deberia devolver un puzzle, vino ${JSON.stringify(first.data)}`);
  const key = first.data.puzzle.key;

  const solRes = await getJson(`/api/${prefix}/${encodeURIComponent(key)}/solution`, token);
  assert(solRes.status === 200, `${label}: GET /${key}/solution -> ${solRes.status}`);
  assert(Array.isArray(solRes.data.solution) && solRes.data.solution.length > 0, `${label}: la solucion deberia ser un array no vacio, vino ${JSON.stringify(solRes.data)}`);

  // La solucion revelada debe ser EXACTAMENTE la que /solve acepta.
  const solveRes = await postJson(`/api/${prefix}/${encodeURIComponent(key)}/solve`, { moves: solRes.data.solution, mode: 'practice' }, token);
  assert(solveRes.status === 200 && solveRes.data.correct === true, `${label}: la solucion revelada deberia ser aceptada por /solve como correcta, vino ${JSON.stringify(solveRes.data)}`);
  console.log(`${label}: GET /:key/solution devuelve la solucion REAL (la misma que /solve acepta).`);

  // ═══════ Puzzle inexistente -> 404, nunca 500 ni solucion inventada ═══════
  const missingRes = await getJson(`/api/${prefix}/no-existe-este-puzzle/solution`, token);
  assert(missingRes.status === 404, `${label}: un puzzle inexistente deberia dar 404, vino ${missingRes.status}`);
  console.log(`${label}: un puzzle inexistente en /solution da 404 (nunca 500 ni una solucion inventada).`);

  // ═══════ exclude=key nunca devuelve ESE key -- Saltar puzzle de verdad ═══════
  const second = await getJson(`/api/${prefix}/practice`, token);
  const secondKey = second.data.puzzle.key;
  const excludedRes = await getJson(`/api/${prefix}/practice?exclude=${encodeURIComponent(secondKey)}`, token);
  assert(excludedRes.status === 200 && excludedRes.data.puzzle, `${label}: /practice?exclude deberia seguir devolviendo un puzzle, vino ${JSON.stringify(excludedRes.data)}`);
  assert(excludedRes.data.puzzle.key !== secondKey, `${label}: "Saltar puzzle" (exclude) NUNCA deberia devolver el mismo puzzle que se salto, vino ${excludedRes.data.puzzle.key}`);
  console.log(`${label}: exclude=${secondKey} en /practice de verdad cambia de puzzle.`);

  // ═══════ Saltar NO marca como resuelto ═══════
  const statsAfterSkip = await getJson(`/api/${prefix}/stats`, token);
  assert(statsAfterSkip.data.totalSolved === 1, `${label}: saltar un puzzle NO deberia sumar a totalSolved (solo el resuelto de verdad arriba cuenta), vino ${statsAfterSkip.data.totalSolved}`);
  console.log(`${label}: saltar un puzzle (exclude) nunca lo marca como resuelto en el perfil.`);
}

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'puzzle-help-flow-test-secret-at-least-32-cha',
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
    const regChess = await register(`pzhelpC_${suffix}`);
    const regDamas = await register(`pzhelpD_${suffix}`);

    await checkGame('Ajedrez', 'puzzles', regChess.token);
    await checkGame('Damas', 'damas-puzzles', regDamas.token);

    console.log('\n✅ PUZZLE_HELP_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ PUZZLE_HELP_FAILED:', err.message);
  process.exit(1);
});
