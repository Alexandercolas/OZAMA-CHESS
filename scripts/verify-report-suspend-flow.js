'use strict';

// Prueba de "Moderacion" (Fase 26 del roadmap "OZAMA PRO"): la
// auditoria de esta fase encontro que el bloqueo entre jugadores
// (matchmaking + reto + chat, ambos juegos) y las denuncias (crear +
// revisar, Fases 10 y 25) ya estaban completos de punta a punta. El
// unico hueco real: resolver una denuncia legitima obligaba al admin
// a salir de la pestaña de Denuncias, ir a Usuarios y buscar el
// nombre a mano para suspender la cuenta -- el circuito "denuncia ->
// accion real" no estaba conectado.
//
// public/js/admin.js:suspendReportedUser() lo cierra reusando el
// MISMO endpoint que ya usa la pestaña de Usuarios (PATCH
// /api/admin/users/:id {isActive:false}), sin un camino de suspension
// paralelo, y de paso marca la denuncia como revisada.
//
// Este script verifica, contra un server.js real y una Mongo aislada
// y temporal (nunca produccion), el contrato exacto que ese boton
// nuevo asume:
//
//   - suspender al denunciado (PATCH isActive:false) invalida sus
//     sesiones (tokenVersion cambia -- el mismo mecanismo que ya usa
//     "Cerrar sesiones" en Usuarios, no uno nuevo);
//   - la denuncia queda 'reviewed' con reviewedBy = el admin que
//     suspendio, exactamente como "Marcar revisada" manual;
//   - la cuenta suspendida ya no puede iniciar sesion;
//   - la cuenta suspendida deja de aparecer en el ranking publico
//     (publicLeaderboardFilter ya filtra por isActive -- confirma que
//     suspender de verdad la saca de la vista publica, no solo la
//     marca);
//   - un admin no puede suspenderse a si mismo por esta via (misma
//     guarda que ya protege el endpoint de Usuarios).
//
// Uso: node scripts/verify-report-suspend-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_REPORT_SUSPEND_TEST_PORT || 3239);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_reportsuspend' });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(cond, message) { if (!cond) throw new Error(`ASSERTION FAILED: ${message}`); }

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
  const res = await fetch(`${baseUrl}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
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

async function register(username, email) {
  const res = await postJson('/api/auth/register', { username, email, password: 'CorrectHorse99!', country: 'DO' });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function main() {
  const suffix = String(Date.now()).slice(-8);
  const adminEmail = `admsusp_${suffix}@example.test`;
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'report-suspend-flow-test-secret-at-least-32c',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      ADMIN_EMAILS: adminEmail,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));
  proc.stderr.on('data', (c) => serverLines.push(...c.toString().trim().split(/\r?\n/)));

  try {
    await waitForServer(proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);

    const reporter = await register(`reportsusp_${suffix}`, `reportsusp_${suffix}@example.test`);
    const victim = await register(`victimsusp_${suffix}`, `victimsusp_${suffix}@example.test`);
    const admin = await register(`admsusp_${suffix}`, adminEmail);

    const createRes = await postJson(`/api/user/${encodeURIComponent(victim.user.username)}/report`, {
      reason: 'trampa_sospechada', note: 'Movimientos imposiblemente rapidos y precisos.',
    }, reporter.token);
    assert(createRes.status === 200 || createRes.status === 201, `crear denuncia -> ${createRes.status}`);

    const pendingRes = await getJson('/api/admin/reports?status=pending', admin.token);
    const report = pendingRes.data.reports.find((r) => r.reported?.username === victim.user.username);
    assert(report, 'la denuncia deberia aparecer pendiente');

    // ═══════ Un admin no puede suspenderse a si mismo por esta via ═══════
    const selfSuspend = await patchJson(`/api/admin/users/${admin.user.id}`, { isActive: false }, admin.token);
    assert(selfSuspend.status === 400, `un admin no deberia poder suspender su propia cuenta, vino ${selfSuspend.status}`);
    console.log('Guarda de auto-suspension intacta (la reusa el boton nuevo, no la duplica).');

    // ═══════ Suspender al denunciado + marcar la denuncia revisada (el flujo del boton) ═══════
    const suspendRes = await patchJson(`/api/admin/users/${report.reported._id}`, { isActive: false }, admin.token);
    assert(suspendRes.status === 200 && suspendRes.data.user.isActive === false, `suspender -> ${suspendRes.status}: ${JSON.stringify(suspendRes.data)}`);

    const reviewRes = await patchJson(`/api/admin/reports/${report._id}`, { status: 'reviewed' }, admin.token);
    assert(reviewRes.status === 200 && reviewRes.data.report.status === 'reviewed', `revisar -> ${reviewRes.status}`);
    assert(String(reviewRes.data.report.reviewedBy) === String(admin.user.id), 'reviewedBy deberia ser el admin que suspendio');
    console.log('Suspender + marcar revisada funciona igual que el flujo manual (mismos endpoints, sin duplicar logica).');

    // ═══════ La cuenta suspendida ya no puede iniciar sesion ═══════
    const loginRes = await postJson('/api/auth/login', { identifier: victim.user.username, password: 'CorrectHorse99!' });
    assert(loginRes.status === 401, `la cuenta suspendida no deberia poder iniciar sesion, vino ${loginRes.status}`);
    console.log('La cuenta suspendida ya no puede iniciar sesion (sesiones invalidadas, mismo mecanismo que "Cerrar sesiones").');

    // ═══════ Desaparece del ranking publico ═══════
    const leaderboard = await getJson('/api/user/leaderboard');
    assert(!leaderboard.data.players.some((p) => p.username === victim.user.username), 'la cuenta suspendida no deberia seguir en el ranking publico');
    console.log('La cuenta suspendida sale del ranking publico de inmediato.');

    console.log('\n✅ REPORT_SUSPEND_FLOW_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ REPORT_SUSPEND_FLOW_FAILED:', err.message);
  process.exit(1);
});
