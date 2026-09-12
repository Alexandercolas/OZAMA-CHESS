'use strict';

// Prueba de punta a punta del Espectador (Fase 4 del roadmap "OZAMA
// PRO"): antes de esta fase nadie podia ver una partida en curso sin
// ser uno de los dos jugadores. Levanta un server.js real contra una
// Mongo aislada y temporal (nunca produccion) y verifica, para Ajedrez
// y Damas por separado:
//
//   - un tercer socket SIN color asignado puede unirse de oyente
//     (spectate-room / damas:spectate-room) a una sala 'playing' y
//     recibe una foto inicial correcta (spectate-start);
//   - ese mismo socket recibe los MISMOS broadcasts que ya reciben los
//     jugadores (board-update / opponent-move) cuando alguien mueve,
//     sin ningun codigo nuevo del lado del que emite la jugada;
//   - un intento de MOVER desde el socket espectador (sin color) es
//     rechazado por las guardas YA EXISTENTES (canUseRoomColor /
//     isAuthorizedRoomSocket / isAuthorizedDamasSocket), sin que haga
//     falta ninguna guarda nueva especifica de espectador;
//   - spectate-room sobre una sala que no existe (o no esta jugando)
//     responde con *-error, no con un crash silencioso;
//   - spectate-leave saca al socket de la sala de Socket.IO (deja de
//     recibir los broadcasts posteriores).
//
// Uso: node scripts/verify-spectator-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_SPECTATOR_TEST_PORT || 3155);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_spectate' });

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

function neverEvent(socket, event, ms = 1200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, onEvent); resolve(); }, ms);
    function onEvent(payload) { clearTimeout(timer); socket.off(event, onEvent); reject(new Error(`no deberia haber llegado "${event}" pero llego: ${JSON.stringify(payload)}`)); }
    socket.once(event, onEvent);
  });
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
      JWT_SECRET: process.env.JWT_SECRET || 'spectator-flow-test-secret-at-least-32-chars',
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
    const pA = await register(`specA_${suffix}`);
    const pB = await register(`specB_${suffix}`);
    const pC = await register(`specC_${suffix}`);
    console.log(`Registrados: A=${pA.user.username}, B=${pB.user.username}, C(espectador)=${pC.user.username}`);

    // ═══════════════════ AJEDREZ ═══════════════════
    // player-move exige sesion (requireSocketAuth), asi que para probar
    // especificamente la guarda de COLOR (no la de auth) el espectador
    // aca usa una cuenta real -- autenticado, pero sin asiento en la sala.
    {
      const sockA = io(baseUrl, { auth: { token: pA.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: pB.token }, reconnection: false, timeout: 5000 });
      const spec = io(baseUrl, { auth: { token: pC.token }, reconnection: false, timeout: 5000 });
      sockets.push(sockA, sockB, spec);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect'), waitEvent(spec, 'connect')]);

      // Sala inexistente -> error, no crash.
      const badErr = waitEvent(spec, 'spectate-error');
      spec.emit('spectate-room', { room: 'ZZZZ' });
      await badErr;
      console.log('Ajedrez: spectate-room sobre sala inexistente -> spectate-error (OK).');

      const createdA = waitEvent(sockA, 'room-created');
      sockA.emit('create-room', { playerName: pA.user.username });
      const roomInfo = await createdA;

      const startA = waitEvent(sockA, 'game-start');
      const startB = waitEvent(sockB, 'game-start');
      sockB.emit('join-room', { code: roomInfo.code, playerName: pB.user.username });
      const [gsA, gsB] = await Promise.all([startA, startB]);
      console.log(`Ajedrez: sala ${roomInfo.code} en juego, blancas=${gsA.color === 'w' ? 'A' : 'B'}.`);

      const specStart = waitEvent(spec, 'spectate-start');
      spec.emit('spectate-room', { room: roomInfo.code });
      const specData = await specStart;
      assert(specData.code === roomInfo.code, 'spectate-start deberia traer el mismo codigo de sala');
      assert(specData.game && specData.game.turn === 'w', 'spectate-start deberia traer el snapshot inicial (turno blancas)');
      console.log('Ajedrez: spectate-start trae el snapshot correcto de la partida en curso.');

      // Mirar no deberia exigir cuenta: un socket totalmente anonimo
      // tambien puede entrar de oyente.
      const anonSpec = io(baseUrl, { reconnection: false, timeout: 5000 });
      sockets.push(anonSpec);
      await waitEvent(anonSpec, 'connect');
      const anonStart = waitEvent(anonSpec, 'spectate-start');
      anonSpec.emit('spectate-room', { room: roomInfo.code });
      await anonStart;
      console.log('Ajedrez: un espectador totalmente anonimo (sin cuenta) tambien puede mirar.');
      anonSpec.close();

      // El espectador ve la MISMA jugada que ve el rival, via el mismo broadcast.
      const whiteSock = gsA.color === 'w' ? sockA : sockB;
      const specSeesMove = waitEvent(spec, 'opponent-move');
      const rivalSeesMove = waitEvent(gsA.color === 'w' ? sockB : sockA, 'opponent-move');
      whiteSock.emit('player-move', { room: roomInfo.code, from: { row: 6, col: 4 }, to: { row: 4, col: 4 } });
      await Promise.all([specSeesMove, rivalSeesMove]);
      console.log('Ajedrez: el espectador recibe opponent-move igual que el rival (mismo broadcast, sin codigo nuevo).');

      // El espectador NO puede mover: esta autenticado y adentro de la
      // sala (se unio a ella), pero socket.data.color nunca se fijo para
      // el -- canUseRoomColor lo rechaza con la MISMA guarda que ya
      // existia para cualquier otro intento de suplantar un color.
      const specGetsRejected = waitEvent(spec, 'move-rejected');
      const noBroadcast = neverEvent(sockA, 'opponent-move', 800);
      spec.emit('player-move', { room: roomInfo.code, from: { row: 1, col: 4 }, to: { row: 3, col: 4 } });
      const rejection = await specGetsRejected;
      await noBroadcast;
      assert(/color/i.test(rejection.message || ''), `el rechazo deberia mencionar el color, vino: ${JSON.stringify(rejection)}`);
      console.log(`Ajedrez: un player-move del espectador es rechazado ("${rejection.message}") por la guarda de color YA existente -- sin board-update.`);

      // spectate-leave: deja de recibir broadcasts de esa sala.
      spec.emit('spectate-leave', { room: roomInfo.code });
      await wait(300);
      const blackSock = gsA.color === 'w' ? sockB : sockA;
      const specShouldNotSeeIt = neverEvent(spec, 'opponent-move', 900);
      blackSock.emit('player-move', { room: roomInfo.code, from: { row: 1, col: 4 }, to: { row: 3, col: 4 } });
      await specShouldNotSeeIt;
      console.log('Ajedrez: tras spectate-leave, el socket ya no recibe broadcasts de esa sala.');

      sockA.close(); sockB.close(); spec.close();
    }

    // ═══════════════════ DAMAS ═══════════════════
    {
      const sockA = io(baseUrl, { auth: { token: pA.token }, reconnection: false, timeout: 5000 });
      const sockB = io(baseUrl, { auth: { token: pB.token }, reconnection: false, timeout: 5000 });
      const spec = io(baseUrl, { reconnection: false, timeout: 5000 });
      sockets.push(sockA, sockB, spec);
      await Promise.all([waitEvent(sockA, 'connect'), waitEvent(sockB, 'connect'), waitEvent(spec, 'connect')]);

      const badErr = waitEvent(spec, 'damas:spectate-error');
      spec.emit('damas:spectate-room', { room: 'ZZZZ' });
      await badErr;
      console.log('Damas: damas:spectate-room sobre sala inexistente -> damas:spectate-error (OK).');

      const createdA = waitEvent(sockA, 'damas:room-created');
      sockA.emit('damas:create-room', { playerName: pA.user.username, country: 'DO' });
      const roomInfo = await createdA;

      const startA = waitEvent(sockA, 'damas:game-start');
      const startB = waitEvent(sockB, 'damas:game-start');
      sockB.emit('damas:join-room', { code: roomInfo.code, playerName: pB.user.username, country: 'DO' });
      const [gsA, gsB] = await Promise.all([startA, startB]);
      console.log(`Damas: sala ${roomInfo.code} en juego, blancas=${gsA.color === 'w' ? 'A' : 'B'}.`);

      const specStart = waitEvent(spec, 'damas:spectate-start');
      spec.emit('damas:spectate-room', { room: roomInfo.code });
      const specData = await specStart;
      assert(specData.code === roomInfo.code, 'damas:spectate-start deberia traer el mismo codigo de sala');
      assert(specData.turn === 'w', 'damas:spectate-start deberia traer el turno inicial (blancas)');
      console.log('Damas: damas:spectate-start trae el snapshot correcto de la partida en curso.');

      const whiteSock = gsA.color === 'w' ? sockA : sockB;
      const specSeesUpdate = waitEvent(spec, 'damas:board-update');
      const rivalSeesUpdate = waitEvent(gsA.color === 'w' ? sockB : sockA, 'damas:board-update');
      whiteSock.emit('damas:move', { room: roomInfo.code, fromR: 5, fromC: 0, seq: [{ toR: 4, toC: 1, capturedR: -1, capturedC: -1 }] });
      await Promise.all([specSeesUpdate, rivalSeesUpdate]);
      console.log('Damas: el espectador recibe damas:board-update igual que el rival.');

      // Damas es guest-friendly (damas:move no exige sesion) -- el
      // espectador aca ni siquiera tiene cuenta, y aun asi la guarda de
      // color (myColor undefined) lo rechaza igual que a cualquiera.
      const specGetsRejected = waitEvent(spec, 'damas:move-rejected');
      const noBroadcast = neverEvent(sockA, 'damas:board-update', 800);
      spec.emit('damas:move', { room: roomInfo.code, fromR: 2, fromC: 1, seq: [{ toR: 3, toC: 0, capturedR: -1, capturedC: -1 }] });
      const rejection = await specGetsRejected;
      await noBroadcast;
      assert(/controlas ese color/i.test(rejection.message || ''), `el rechazo deberia mencionar el color, vino: ${JSON.stringify(rejection)}`);
      console.log(`Damas: un damas:move del espectador es rechazado ("${rejection.message}") por la guarda de color YA existente -- sin board-update.`);

      spec.emit('damas:spectate-leave', { room: roomInfo.code });
      await wait(300);
      const blackSock = gsA.color === 'w' ? sockB : sockA;
      const specShouldNotSeeIt = neverEvent(spec, 'damas:board-update', 900);
      blackSock.emit('damas:move', { room: roomInfo.code, fromR: 2, fromC: 1, seq: [{ toR: 3, toC: 0, capturedR: -1, capturedC: -1 }] });
      await specShouldNotSeeIt;
      console.log('Damas: tras damas:spectate-leave, el socket ya no recibe broadcasts de esa sala.');

      sockA.close(); sockB.close(); spec.close();
    }

    console.log('\n✅ SPECTATOR_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ SPECTATOR_FLOW_FAILED:', err.message);
  process.exit(1);
});
