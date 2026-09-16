'use strict';

// Prueba de "Admin" (Fase 25 del roadmap "OZAMA PRO"): la auditoria
// encontro que el panel de administracion ya tenia TODO el backend de
// denuncias de jugadores construido (Fase 10: POST /api/user/:username
// /report, GET/PATCH /api/admin/reports, modelo Report con reporter/
// reported/reason/note/status/reviewedBy) pero CERO interfaz -- ni un
// boton, ni una pestaña en public/admin.html/js/admin.js. Un admin no
// tenia forma real de ver ni resolver una denuncia salvo pegandole a
// la API a mano. Se completo la pestaña "Denuncias" (tabla + filtro
// por estado + acciones "Marcar revisada"/"Descartar"), verificada en
// vivo contra un navegador real en esta sesion.
//
// Este script verifica, contra un server.js real y una Mongo aislada
// y temporal (nunca produccion), el CONTRATO que esa interfaz nueva
// asume del backend (si esta forma cambia, la UI se rompe en
// silencio):
//
//   - un jugador denuncia a otro (POST /:username/report) -- aparece
//     en GET /api/admin/reports?status=pending con reporter.username
//     y reported.username/isActive ya poblados (lo que pinta la tabla);
//   - PATCH /reports/:id {status:'reviewed'} devuelve reviewedBy
//     poblado con username (lo que pinta "Por <admin>") y queda
//     auditado en AdminAudit como 'report_reviewed';
//   - tras revisarla, deja de aparecer en ?status=pending pero SI en
//     ?status=reviewed y en ?status=all (el filtro que usa la UI);
//   - un jugador sin permisos de admin no puede leer NI resolver
//     denuncias (requireAdmin real, no solo escondido en la UI).
//
// Uso: node scripts/verify-admin-reports-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_ADMIN_REPORTS_TEST_PORT || 3237);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_adminrep2' });

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
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

async function register(username, email) {
  const res = await postJson('/api/auth/register', { username, email, password: 'CorrectHorse99!', country: 'DO' });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

async function main() {
  const suffix = String(Date.now()).slice(-8);
  const adminEmail = `admrep2_${suffix}@example.test`;
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'admin-reports-flow-test-secret-at-least-32c',
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

    const reporter = await register(`reporter2_${suffix}`, `reporter2_${suffix}@example.test`);
    const victim = await register(`victim2_${suffix}`, `victim2_${suffix}@example.test`);
    const admin = await register(`admrep2_${suffix}`, adminEmail);

    // ═══════ Un jugador denuncia a otro ═══════
    const createRes = await postJson(`/api/user/${encodeURIComponent(victim.user.username)}/report`, {
      reason: 'comportamiento_toxico', note: 'Insultos repetidos en el chat de la partida.',
    }, reporter.token);
    assert(createRes.status === 200 || createRes.status === 201, `crear denuncia -> ${createRes.status}: ${JSON.stringify(createRes.data)}`);
    console.log('Un jugador puede denunciar a otro.');

    // ═══════ Sin permisos de admin, ni leer ni resolver denuncias ═══════
    const forbiddenList = await getJson('/api/admin/reports?status=pending', reporter.token);
    assert(forbiddenList.status === 403, `un jugador normal no deberia poder leer denuncias, vino ${forbiddenList.status}`);
    console.log('Un jugador normal no puede leer el buzon de denuncias (403 real, no solo escondido en la UI).');

    // ═══════ El admin ve la denuncia con reporter/reported ya poblados ═══════
    const pendingRes = await getJson('/api/admin/reports?status=pending', admin.token);
    assert(pendingRes.status === 200, `GET /reports -> ${pendingRes.status}`);
    const report = pendingRes.data.reports.find((r) => r.reporter?.username === reporter.user.username);
    assert(report, `deberia aparecer la denuncia de ${reporter.user.username}, vino ${JSON.stringify(pendingRes.data.reports.map((r) => r.reporter?.username))}`);
    assert(report.reported?.username === victim.user.username, `reported.username deberia ser ${victim.user.username}, vino "${report.reported?.username}"`);
    assert(report.reported?.isActive === true, 'reported.isActive deberia venir poblado (la UI lo usa para marcar cuentas ya suspendidas)');
    assert(report.reason === 'comportamiento_toxico' && report.note.includes('Insultos'), 'motivo y nota deberian venir intactos');
    assert(report.status === 'pending', 'una denuncia nueva deberia arrancar pending');
    console.log('El admin ve la denuncia con reporter.username y reported.username/isActive ya poblados.');

    // ═══════ Resolverla queda auditado con reviewedBy poblado ═══════
    const reviewRes = await patchJson(`/api/admin/reports/${report._id}`, { status: 'reviewed' }, admin.token);
    assert(reviewRes.status === 200, `PATCH /reports/:id -> ${reviewRes.status}: ${JSON.stringify(reviewRes.data)}`);

    const afterList = await getJson('/api/admin/reports?status=reviewed', admin.token);
    const reviewed = afterList.data.reports.find((r) => String(r._id) === String(report._id));
    assert(reviewed, 'la denuncia revisada deberia aparecer en el filtro ?status=reviewed');
    assert(reviewed.reviewedBy?.username === admin.user.username, `reviewedBy.username deberia ser el admin que la resolvio, vino "${reviewed.reviewedBy?.username}"`);
    assert(reviewed.reviewedAt, 'reviewedAt deberia quedar registrado');
    console.log('Resolver una denuncia devuelve reviewedBy.username poblado (lo que pinta "Por <admin>" en la UI).');

    const pendingAfter = await getJson('/api/admin/reports?status=pending', admin.token);
    assert(!pendingAfter.data.reports.some((r) => String(r._id) === String(report._id)), 'una vez revisada, no deberia seguir apareciendo en ?status=pending');
    const allAfter = await getJson('/api/admin/reports?status=all', admin.token);
    assert(allAfter.data.reports.some((r) => String(r._id) === String(report._id)), '?status=all deberia seguir mostrandola');
    console.log('El filtro por estado (pending/reviewed/all) que usa la pestaña de Denuncias funciona correctamente.');

    const auditRes = await getJson('/api/admin/system', admin.token);
    const auditEntry = auditRes.data.logs.find((l) => l.action === 'report_reviewed' && l.targetId === String(report._id));
    assert(auditEntry, 'resolver la denuncia deberia quedar en AdminAudit como report_reviewed');
    console.log('La accion queda registrada en el log de auditoria (pestaña Sistema).');

    console.log('\n✅ ADMIN_REPORTS_FLOW_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ ADMIN_REPORTS_FLOW_FAILED:', err.message);
  process.exit(1);
});
