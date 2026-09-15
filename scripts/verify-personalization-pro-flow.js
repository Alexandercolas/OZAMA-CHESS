'use strict';

// Prueba de punta a punta de "Personalizacion PRO" (Fase 11 del roadmap
// "OZAMA PRO"): auditoria previa encontro que el tema de tablero, los
// sets de piezas (Ajedrez/Damas) y el tema de plataforma YA existian
// como preferencias completas (public/preferences.js + PATCH
// /api/user/preferences) -- lo que faltaba era (A) una bio corta de
// perfil, (B) un toggle explicito de efectos de animacion (aparte de
// prefers-reduced-motion, que es del SO) y (C) que el tema de
// plataforma tambien se pudiera elegir desde collection.html, no solo
// desde ajustes. Este script verifica solo lo que es verificable por
// API/servidor (A y B); C es puramente de UI (collection.html), ya
// cubierto por node scripts/verify.js + revision visual.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion):
//
//   - PATCH /api/user/me con bio la guarda recortada/trimeada;
//   - la bio aparece en GET /me Y en el perfil publico;
//   - una bio de mas de 140 caracteres se recorta a 140;
//   - una bio vacia no rompe nada (campo opcional, nunca obligatorio);
//   - PATCH /api/user/preferences con effectsEnabled se guarda y
//     aparece en el /preferences devuelto, con el resto de
//     preferencias existentes (boardTheme, platformTheme...) intactas;
//   - effectsEnabled rechaza un valor que no sea booleano.
//
// Uso: node scripts/verify-personalization-pro-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_PERSONALIZATION_TEST_PORT || 3223);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_persz' });

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
      JWT_SECRET: process.env.JWT_SECRET || 'personalization-flow-test-secret-at-least-32-chars',
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
    const reg = await register(`bioU_${suffix}`);
    const token = reg.token;
    const username = reg.user.username;

    // ═══════ Bio: guardarla y verla en /me y perfil publico ═══════
    const bioText = 'Ajedrez por las noches, Damas los domingos.';
    const bioSave = await patchJson('/api/user/me', { bio: bioText }, token);
    assert(bioSave.status === 200, `PATCH /me con bio -> ${bioSave.status} ${JSON.stringify(bioSave.data)}`);
    assert(bioSave.data.user.bio === bioText, `la bio devuelta deberia coincidir, vino "${bioSave.data.user.bio}"`);
    console.log('bio: PATCH /me guarda la bio y la devuelve.');

    const meAfterBio = await getJson('/api/user/me', token);
    assert(meAfterBio.data.user.bio === bioText, `GET /me deberia traer la bio guardada, vino "${meAfterBio.data.user.bio}"`);

    const publicProfile = await getJson(`/api/user/${username}`);
    assert(publicProfile.data.user.bio === bioText, `el perfil publico deberia mostrar la bio, vino "${publicProfile.data.user.bio}"`);
    console.log('bio: aparece tanto en /me como en el perfil publico.');

    // ═══════ Bio: se recorta a 140 caracteres ═══════
    const longBio = 'x'.repeat(200);
    const longSave = await patchJson('/api/user/me', { bio: longBio }, token);
    assert(longSave.status === 200, `PATCH /me con bio larga -> ${longSave.status}`);
    assert(longSave.data.user.bio.length === 140, `una bio de 200 caracteres deberia recortarse a 140, vino ${longSave.data.user.bio.length}`);
    console.log('bio: una bio mas larga que 140 caracteres se recorta a 140.');

    // ═══════ Bio: vacia no rompe nada (campo opcional) ═══════
    const emptySave = await patchJson('/api/user/me', { bio: '' }, token);
    assert(emptySave.status === 200 && emptySave.data.user.bio === '', `una bio vacia deberia aceptarse y quedar "", vino ${JSON.stringify(emptySave.data.user?.bio)}`);
    console.log('bio: una bio vacia se acepta sin problema (nunca obligatoria).');

    // ═══════ effectsEnabled: se guarda junto al resto de preferencias ═══════
    const prefsBefore = await patchJson('/api/user/preferences', { boardTheme: 'colonial', soundVolume: 0.5 }, token);
    assert(prefsBefore.status === 200, `PATCH /preferences base -> ${prefsBefore.status}`);

    const fxOff = await patchJson('/api/user/preferences', { effectsEnabled: false }, token);
    assert(fxOff.status === 200, `PATCH /preferences effectsEnabled:false -> ${fxOff.status} ${JSON.stringify(fxOff.data)}`);
    assert(fxOff.data.preferences.effectsEnabled === false, `effectsEnabled deberia quedar false, vino ${JSON.stringify(fxOff.data.preferences)}`);
    assert(fxOff.data.preferences.boardTheme === 'colonial', 'el resto de preferencias (boardTheme) no deberia perderse al guardar effectsEnabled');
    assert(fxOff.data.preferences.soundVolume === 0.5, 'el resto de preferencias (soundVolume) no deberia perderse al guardar effectsEnabled');
    console.log('effectsEnabled: se guarda sin pisar el resto de las preferencias ya guardadas.');

    const fxOn = await patchJson('/api/user/preferences', { effectsEnabled: true }, token);
    assert(fxOn.status === 200 && fxOn.data.preferences.effectsEnabled === true, `volver a true deberia funcionar, vino ${JSON.stringify(fxOn.data)}`);
    console.log('effectsEnabled: se puede volver a activar.');

    // ═══════ effectsEnabled: rechaza un valor no booleano ═══════
    const fxInvalid = await patchJson('/api/user/preferences', { effectsEnabled: 'off' }, token);
    assert(fxInvalid.status === 400, `effectsEnabled no booleano deberia dar 400, vino ${fxInvalid.status}`);
    console.log('effectsEnabled: un valor no booleano se rechaza con 400.');

    console.log('\n✅ PERSONALIZATION_PRO_FLOW_OK');
  } finally {
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ PERSONALIZATION_PRO_FLOW_FAILED:', err.message);
  process.exit(1);
});
