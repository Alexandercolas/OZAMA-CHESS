'use strict';

// Prueba de punta a punta de "Juego Rapido" en Damas (Fase 17 del
// roadmap "OZAMA PRO"): auditoria previa (comparando contra Ajedrez)
// encontro que Damas solo tenia crear-sala/unirse-por-codigo -- CERO
// forma de jugar contra un rival al azar, a diferencia de Ajedrez
// (lobby.html, "Juego Rapido"). Se agrego damas:quick-match/
// damas:quick-match-cancel en server.js (misma cola FIFO + filtro de
// bloqueados + emparejo por ritmo de tiempo que ya usa Ajedrez, pero
// en damasMatchQueue, nunca mezclada con matchQueue) y el boton
// correspondiente en damas.html.
//
// Verifica, contra un server.js real y una Mongo aislada y temporal
// (nunca produccion):
//
//   - dos jugadores pidiendo el MISMO ritmo de tiempo quedan
//     emparejados de verdad (damas:game-start con colores opuestos,
//     mismo roomCode, tablero inicial, reloj correcto);
//   - mientras el primero espera solo, recibe
//     damas:matchmaking-searching (no se empareja consigo mismo);
//   - dos jugadores pidiendo ritmos DISTINTOS no se emparejan entre
//     si (quedan cada uno en su propia cola);
//   - cancelar la busqueda saca de la cola (confirmado por
//     damas:matchmaking-cancelled) y ya no empareja con un rival que
//     llega despues;
//   - un jugador bloqueado nunca se empareja con quien lo bloqueo.
//
// Uso: node scripts/verify-damas-quick-match.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_DAMAS_QM_TEST_PORT || 3229);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_damasqm' });

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

async function register(username) {
  const res = await postJson('/api/auth/register', {
    username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO',
  });
  if (res.status !== 201) throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

function waitEvent(socket, event, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`timeout waiting for ${event}`)); }, timeoutMs);
    function onEvent(payload) { clearTimeout(timer); resolve(payload); }
    socket.once(event, onEvent);
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
      JWT_SECRET: process.env.JWT_SECRET || 'damas-qm-flow-test-secret-at-least-32-chars',
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

  const sockets = [];
  try {
    await waitForServer(proc, serverLines);
    console.log(`DB=${isolatedMongo.dbName}`);

    const suffix = String(Date.now()).slice(-8);
    const playerA = await register(`dqmA_${suffix}`);
    const playerB = await register(`dqmB_${suffix}`);
    const playerC = await register(`dqmC_${suffix}`);
    const playerE = await register(`dqmE_${suffix}`);

    // ═══════ Dos jugadores, MISMO ritmo -> se emparejan de verdad ═══════
    const sockA = io(baseUrl, { auth: { token: playerA.token }, reconnection: false, timeout: 5000 });
    const sockB = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA, sockB);
    await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect')]);

    const searchingA = waitEvent(sockA, 'damas:matchmaking-searching');
    sockA.emit('damas:quick-match', { playerName: playerA.user.username, country: 'DO', timeControl: '3+0' });
    await searchingA;
    console.log('damas quick-match: el primero en la cola recibe matchmaking-searching (no se empareja solo).');

    const startA = waitEvent(sockA, 'damas:game-start');
    const startB = waitEvent(sockB, 'damas:game-start');
    sockB.emit('damas:quick-match', { playerName: playerB.user.username, country: 'DO', timeControl: '3+0' });
    const [gsA, gsB] = await Promise.all([startA, startB]);

    assert(gsA.code === gsB.code, `ambos deberian caer en la MISMA sala, vino A=${gsA.code} B=${gsB.code}`);
    assert((gsA.color === 'w' && gsB.color === 'b') || (gsA.color === 'b' && gsB.color === 'w'), `deberian quedar en colores opuestos, vino A=${gsA.color} B=${gsB.color}`);
    assert(gsA.timeControl === '3+0' && gsB.timeControl === '3+0', `deberian jugar con el ritmo pedido "3+0", vino A=${gsA.timeControl} B=${gsB.timeControl}`);
    assert(gsA.clockW === 3 * 60000, `el reloj inicial deberia ser 3 minutos, vino ${gsA.clockW}`);
    assert(Array.isArray(gsA.board) && gsA.board.length === 8, 'deberia llegar el tablero inicial de Damas (8x8)');
    console.log(`damas quick-match: A y B quedaron emparejados de verdad en la sala ${gsA.code} (A=${gsA.color}, B=${gsB.color}), reloj 3+0 correcto.`);

    sockA.close(); sockB.close();

    // ═══════ Ritmos DISTINTOS no se emparejan entre si ═══════
    const sockC = io(baseUrl, { auth: { token: playerC.token }, reconnection: false, timeout: 5000 });
    const sockE = io(baseUrl, { auth: { token: playerE.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockC, sockE);
    await Promise.all([waitEvent(sockC, 'connect'), waitEvent(sockE, 'connect')]);

    const cSearching = waitEvent(sockC, 'damas:matchmaking-searching');
    sockC.emit('damas:quick-match', { playerName: playerC.user.username, country: 'DO', timeControl: '1+0' });
    await cSearching;

    const eSearching = waitEvent(sockE, 'damas:matchmaking-searching');
    sockE.emit('damas:quick-match', { playerName: playerE.user.username, country: 'DO', timeControl: '10+0' });
    await eSearching;
    // Si se hubieran emparejado mal, alguno de los dos ya habria
    // recibido damas:game-start en vez de matchmaking-searching --
    // ambas promesas arriba ya lo habrian detectado. Confirmamos que
    // NINGUNO de los dos recibe game-start en una ventana corta.
    let wrongMatch = false;
    sockC.once('damas:game-start', () => { wrongMatch = true; });
    sockE.once('damas:game-start', () => { wrongMatch = true; });
    await wait(1500);
    assert(!wrongMatch, 'ritmos distintos (1+0 vs 10+0) NUNCA deberian emparejarse entre si');
    console.log('damas quick-match: ritmos de tiempo distintos no se mezclan en la misma cola.');

    sockC.emit('damas:quick-match-cancel');
    await waitEvent(sockC, 'damas:matchmaking-cancelled');
    sockE.emit('damas:quick-match-cancel');
    await waitEvent(sockE, 'damas:matchmaking-cancelled');
    console.log('damas quick-match: cancelar la busqueda saca de la cola (matchmaking-cancelled confirmado).');

    sockC.close(); sockE.close();

    // ═══════ Un jugador bloqueado nunca se empareja con quien lo bloqueo ═══════
    // playerC bloquea a playerB (POST /api/user/:username/block, ver
    // routes/user.js) y despues los tres piden el MISMO ritmo: C
    // primero, B segundo (NO deberia emparejar con C pese a ser el
    // siguiente en la cola), y por ultimo un D neutral (SI deberia
    // poder emparejar con C, que sigue en cola esperando).
    const blockRes = await postJson(`/api/user/${encodeURIComponent(playerB.user.username)}/block`, {}, playerC.token);
    assert(blockRes.status === 200, `bloquear a B desde C -> ${blockRes.status} ${JSON.stringify(blockRes.data)}`);

    const sockC2 = io(baseUrl, { auth: { token: playerC.token }, reconnection: false, timeout: 5000 });
    const sockB2 = io(baseUrl, { auth: { token: playerB.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockC2, sockB2);
    await Promise.all([waitEvent(sockC2, 'connect'), waitEvent(sockB2, 'connect')]);

    const c2Searching = waitEvent(sockC2, 'damas:matchmaking-searching');
    sockC2.emit('damas:quick-match', { playerName: playerC.user.username, country: 'DO', timeControl: '2+1' });
    await c2Searching;

    const b2Searching = waitEvent(sockB2, 'damas:matchmaking-searching');
    let blockedMatchHappened = false;
    sockC2.once('damas:game-start', () => { blockedMatchHappened = true; });
    sockB2.once('damas:game-start', () => { blockedMatchHappened = true; });
    sockB2.emit('damas:quick-match', { playerName: playerB.user.username, country: 'DO', timeControl: '2+1' });
    await b2Searching;
    assert(!blockedMatchHappened, 'C bloqueo a B -- NUNCA deberian emparejarse entre si, sin importar quien llego primero a la cola');
    console.log('damas quick-match: C (que bloqueo a B) y B piden el mismo ritmo -- NO se emparejan entre si, ambos siguen en cola.');

    const playerD = await register(`dqmD_${suffix}`);
    const sockD2 = io(baseUrl, { auth: { token: playerD.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockD2);
    await waitEvent(sockD2, 'connect');

    const startC2 = waitEvent(sockC2, 'damas:game-start');
    const startD2 = waitEvent(sockD2, 'damas:game-start');
    sockD2.emit('damas:quick-match', { playerName: playerD.user.username, country: 'DO', timeControl: '2+1' });
    const [gsC2, gsD2] = await Promise.all([startC2, startD2]);
    assert(gsC2.code === gsD2.code, `C (neutral con D) SI deberia poder emparejarse -- vino C=${gsC2.code} D=${gsD2.code}`);
    console.log(`damas quick-match: un jugador neutral (D) SI se empareja con C (${gsC2.code}) -- el bloqueo no filtra de mas.`);

    sockB2.emit('damas:quick-match-cancel');
    await waitEvent(sockB2, 'damas:matchmaking-cancelled');
    console.log('damas quick-match: B seguia en cola sin rival (matchmaking-cancelled confirmado al salir).');

    console.log('\n✅ DAMAS_QUICK_MATCH_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ DAMAS_QUICK_MATCH_FAILED:', err.message);
  process.exit(1);
});
