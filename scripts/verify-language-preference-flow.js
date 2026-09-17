'use strict';

// Prueba de "Idiomas" (Fase 29 del roadmap "OZAMA PRO"): la auditoria
// encontro CERO infraestructura de i18n -- todo el texto vivia
// hardcodeado en español directo en el markup. Se construyo el sistema
// completo (public/i18n.js + public/locales/{es,en}.json) y se conecto
// a la landing, login/registro y el lobby como v1 real -- los mensajes
// de error que vienen del servidor siguen en español (ver comentario
// en i18n.js), traducir esos es un trabajo aparte y mucho mas grande.
//
// Este script verifica, contra un server.js real y una Mongo aislada y
// temporal (nunca produccion), el CONTRATO server-side que el selector
// de idioma nuevo asume:
//
//   - un usuario nuevo arranca con preferences.language sin definir
//     (el idioma por defecto lo decide el navegador/localStorage, no
//     el servidor);
//   - PATCH /api/user/preferences {language:'en'} lo guarda y GET
//     /api/user/me lo devuelve de vuelta -- asi la preferencia
//     sincroniza entre dispositivos, no solo en localStorage;
//   - un idioma invalido se rechaza con 400, nunca se guarda silencioso;
//   - la ruta reusa el MISMO endpoint que ya usan boardTheme/soundMuted/
//     etc. (sin duplicar un endpoint de idioma aparte).
//
// Uso: node scripts/verify-language-preference-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_LANG_TEST_PORT || 3243);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_lang' });

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

async function main() {
  const serverLines = [];
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'language-preference-flow-test-secret-32c',
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
    const reg = await postJson('/api/auth/register', {
      username: `langU_${suffix}`, email: `langu_${suffix}@example.test`, password: 'CorrectHorse99!', country: 'DO',
    });
    assert(reg.status === 201, `register -> ${reg.status}: ${JSON.stringify(reg.data)}`);
    const token = reg.data.token;

    // ═══════ Un usuario nuevo no tiene idioma forzado por el servidor ═══════
    const meBefore = await getJson('/api/user/me', token);
    assert(meBefore.status === 200, `GET /me -> ${meBefore.status}`);
    assert(!meBefore.data.user.preferences?.language, `un usuario nuevo no deberia tener preferences.language, vino "${meBefore.data.user.preferences?.language}"`);
    console.log('language: un usuario nuevo arranca sin idioma forzado server-side (lo decide el navegador).');

    // ═══════ Guardar 'en' se refleja en /me (sincroniza entre dispositivos) ═══════
    const patchRes = await patchJson('/api/user/preferences', { language: 'en' }, token);
    assert(patchRes.status === 200, `PATCH preferences -> ${patchRes.status}: ${JSON.stringify(patchRes.data)}`);
    assert(patchRes.data.preferences?.language === 'en', `la respuesta del PATCH deberia confirmar language:'en', vino ${JSON.stringify(patchRes.data.preferences)}`);

    const meAfter = await getJson('/api/user/me', token);
    assert(meAfter.data.user.preferences?.language === 'en', `GET /me deberia devolver preferences.language:'en', vino "${meAfter.data.user.preferences?.language}"`);
    console.log('language: PATCH /api/user/preferences guarda el idioma y GET /me lo devuelve (sincroniza entre dispositivos).');

    // ═══════ Un idioma invalido se rechaza, nunca se guarda silencioso ═══════
    const badRes = await patchJson('/api/user/preferences', { language: 'fr' }, token);
    assert(badRes.status === 400, `un idioma no soportado deberia rechazarse con 400, vino ${badRes.status}`);
    const meAfterBad = await getJson('/api/user/me', token);
    assert(meAfterBad.data.user.preferences?.language === 'en', 'un intento invalido no deberia pisar el idioma ya guardado');
    console.log('language: un idioma invalido (fr) se rechaza con 400 y no pisa el valor ya guardado.');

    // ═══════ Reusa el mismo endpoint que boardTheme/soundMuted (no uno paralelo) ═══════
    const combined = await patchJson('/api/user/preferences', { language: 'es', soundMuted: true }, token);
    assert(combined.status === 200, `combinar language con otra preferencia -> ${combined.status}`);
    assert(combined.data.preferences?.language === 'es' && combined.data.preferences?.soundMuted === true, `deberian actualizarse ambas a la vez, vino ${JSON.stringify(combined.data.preferences)}`);
    console.log('language: comparte el mismo endpoint /api/user/preferences que el resto de personalizacion, sin duplicar rutas.');

    console.log('\n✅ LANGUAGE_PREFERENCE_FLOW_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ LANGUAGE_PREFERENCE_FLOW_FAILED:', err.message);
  process.exit(1);
});
