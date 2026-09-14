'use strict';

// Prueba de punta a punta del centro de notificaciones (Fase 8 del
// roadmap "OZAMA PRO"): auditoria previa confirmo que esto no existia
// en absoluto -- ni modelo, ni endpoint, ni "leido/no leido", ni
// entrega en vivo a un usuario que no estuviera mirando la pagina
// exacta del evento. Levanta un server.js real contra una Mongo
// aislada y temporal (nunca produccion) y verifica:
//
//   - GET /api/user/notifications / POST .../read-all / POST
//     .../:id/read funcionan correctamente (lista, contador de no
//     leidas, marcar todo, marcar una);
//   - "amigo" (nuevo, antes no avisaba nada): agregar amigo notifica
//     al OTRO lado, no a quien inicio la accion;
//   - la notificacion llega EN VIVO por socket (room personal
//     "user:<id>", nueva infraestructura agregada en
//     io.on('connection')) a quien ya esta conectado, ademas de
//     quedar persistida para cuando no lo este;
//   - "invitacion" y "revancha" (Ajedrez): ya emitian un evento en
//     vivo, ahora tambien quedan notificados de forma persistente;
//   - flujo de torneo completo (4 jugadores, eliminacion directa, 2
//     rondas) verifica "inicio_torneo" (los 4 participantes, al
//     auto-arrancar), "torneo" (los 2 ganadores de la ronda 1, cuando
//     se genera la ronda 2 -- esto no existia de NINGUNA forma antes)
//     y "recompensa" (primer_torneo para los 4, finalista_torneo para
//     el subcampeon, campeon_torneo para el campeon).
//
// Uso: node scripts/verify-notifications-flow.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_NOTIF_TEST_PORT || 3211);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_notif' });

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

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function createDueTournament(adminToken, { title, format, maxPlayers }) {
  const created = await postJson('/api/admin/events', {
    title, type: 'tournament', status: 'published', format, maxPlayers,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
  }, adminToken);
  if (created.status !== 201) throw new Error(`crear torneo "${title}" -> ${created.status} ${JSON.stringify(created.data)}`);
  return created.data.event._id;
}

async function main() {
  const serverLines = [];
  const adminSuffix = String(Date.now()).slice(-8);
  const adminUsername = `notifadmin_${adminSuffix}`;
  const adminEmail = `${adminUsername.toLowerCase()}@example.test`;

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'notifications-flow-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      ADMIN_EMAILS: adminEmail,
      OZAMA_AUTOSTART_THROTTLE_MS: '10',
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

    const admin = await register(adminUsername);
    const suffix = String(Date.now()).slice(-8);
    const a = await register(`notifA_${suffix}`);
    const b = await register(`notifB_${suffix}`);

    // ═══════ Endpoints basicos: vacio al principio ═══════
    const emptyList = await getJson('/api/user/notifications', b.token);
    assert(emptyList.status === 200 && emptyList.data.notifications.length === 0 && emptyList.data.unreadCount === 0,
      `un usuario nuevo deberia arrancar sin notificaciones, vino ${JSON.stringify(emptyList.data)}`);
    console.log('Endpoints: usuario nuevo arranca con lista vacia y unreadCount=0.');

    // ═══════ "amigo": notifica al OTRO lado, en vivo Y persistente ═══════
    const sockB = io(baseUrl, { auth: { token: b.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockB);
    await waitEvent(sockB, 'connect');
    // Un momento para que el socket termine de unirse a su room
    // personal (io.on('connection') corre justo despues del connect).
    await wait(200);

    const liveNotif = waitEvent(sockB, 'notification');
    const addRes = await postJson(`/api/user/friends/${b.user.username}`, {}, a.token);
    assert(addRes.status === 200, `agregar amigo -> ${addRes.status} ${JSON.stringify(addRes.data)}`);
    const pushed = await liveNotif;
    assert(pushed.type === 'amigo' && pushed.title.includes(a.user.username), `deberia llegar EN VIVO a B con type 'amigo', vino ${JSON.stringify(pushed)}`);
    console.log('amigo: B recibe la notificacion EN VIVO por su room personal (user:<id>) apenas A lo agrega.');

    const listAfterFriend = await getJson('/api/user/notifications', b.token);
    assert(listAfterFriend.data.unreadCount === 1 && listAfterFriend.data.notifications[0].type === 'amigo',
      `deberia quedar persistida y sin leer, vino ${JSON.stringify(listAfterFriend.data)}`);
    console.log('amigo: tambien queda persistida (unreadCount=1) para cuando B no este conectado.');

    const listForA = await getJson('/api/user/notifications', a.token);
    assert(listForA.data.notifications.length === 0, 'A (quien inicio la accion) NO deberia recibir una notificacion de su propia accion');
    console.log('amigo: A (quien agrego) no se auto-notifica.');

    // ═══════ Marcar como leida (una y todas) ═══════
    const notifId = listAfterFriend.data.notifications[0].id || listAfterFriend.data.notifications[0]._id;
    const readOneRes = await postJson(`/api/user/notifications/${notifId}/read`, {}, b.token);
    assert(readOneRes.status === 200, `marcar una como leida -> ${readOneRes.status}`);
    const afterReadOne = await getJson('/api/user/notifications', b.token);
    assert(afterReadOne.data.unreadCount === 0, 'tras marcar la unica notificacion como leida, unreadCount deberia ser 0');
    console.log('Endpoints: marcar una notificacion como leida baja el contador.');

    // Genera una segunda notificacion para probar "marcar TODAS".
    const c = await register(`notifC_${suffix}`);
    await postJson(`/api/user/friends/${b.user.username}`, {}, c.token);
    const beforeMarkAll = await getJson('/api/user/notifications', b.token);
    assert(beforeMarkAll.data.unreadCount === 1, 'deberia haber 1 nueva notificacion sin leer antes de "marcar todo"');
    const markAllRes = await postJson('/api/user/notifications/read-all', {}, b.token);
    assert(markAllRes.status === 200, `marcar todo leido -> ${markAllRes.status}`);
    const afterMarkAll = await getJson('/api/user/notifications', b.token);
    assert(afterMarkAll.data.unreadCount === 0, `"marcar todo como leido" deberia dejar unreadCount=0, vino ${afterMarkAll.data.unreadCount}`);
    console.log('Endpoints: "marcar todo como leido" (pedido explicito del roadmap) funciona.');

    // ═══════ "invitacion" y "revancha" (Ajedrez) ═══════
    const sockA = io(baseUrl, { auth: { token: a.token }, reconnection: false, timeout: 5000 });
    sockets.push(sockA);
    await waitEvent(sockA, 'connect');
    await wait(200);

    const inviteLive = waitEvent(sockA, 'notification');
    const challengeReceivedWaiter = waitEvent(sockA, 'challenge-received');
    const challengeSentWaiter = waitEvent(sockB, 'challenge-sent');
    sockB.emit('challenge-send', { targetUsername: a.user.username });
    await challengeSentWaiter;
    const inviteNotif = await inviteLive;
    assert(inviteNotif.type === 'invitacion', `deberia notificar type 'invitacion', vino ${JSON.stringify(inviteNotif)}`);
    console.log('invitacion: desafio de Ajedrez notifica en vivo a quien lo recibe.');

    // Juega una partida corta (A se rinde) para poder pedir revancha.
    const challengeReceived = await challengeReceivedWaiter;
    const startA = waitEvent(sockA, 'game-start');
    const startB = waitEvent(sockB, 'game-start');
    sockA.emit('challenge-accept', { challengerSocketId: challengeReceived.socketId });
    const [gsA] = await Promise.all([startA, startB]);
    // player-resign solo emite 'opponent-resigned' al RIVAL (no hay
    // 'game-finished' sin que el cliente lo reporte aparte) -- alcanza
    // con esto para que room.status quede 'finished' server-side, que
    // es lo unico que rematch-request exige mas abajo.
    const resignedWaiter = waitEvent(sockB, 'opponent-resigned');
    sockA.emit('player-resign', { room: gsA.code, pgn: '' });
    await resignedWaiter;

    const rematchLive = waitEvent(sockA, 'notification');
    sockB.emit('rematch-request', { room: gsA.code });
    const rematchNotif = await rematchLive;
    assert(rematchNotif.type === 'revancha', `deberia notificar type 'revancha', vino ${JSON.stringify(rematchNotif)}`);
    console.log('revancha: pedir revancha notifica en vivo al rival.');

    sockA.close(); sockB.close();

    // ═══════ Torneo completo: inicio_torneo + torneo + recompensa ═══════
    const p = {};
    for (const key of ['p1', 'p2', 'p3', 'p4']) p[key] = await register(`${key}_${suffix}`);

    const socksByUsername = {};
    for (const key of Object.keys(p)) {
      const s = io(baseUrl, { auth: { token: p[key].token }, reconnection: false, timeout: 5000 });
      sockets.push(s);
      socksByUsername[p[key].user.username] = s;
      await waitEvent(s, 'connect');
    }
    await wait(200); // que los 4 terminen de unirse a su room personal

    const eventId = await createDueTournament(admin.token, { title: 'Notif Elim Test', format: 'elimination', maxPlayers: 4 });
    for (const key of Object.keys(p)) await postJson(`/api/events/${eventId}/join`, {}, p[key].token);

    // El auto-inicio dispara "inicio_torneo" para los 4 -- se arman
    // los listeners ANTES del GET que lo dispara.
    const startNotifs = Promise.all(Object.values(socksByUsername).map((s) => waitEvent(s, 'notification')));
    await getJson(`/api/events/${eventId}`); // dispara maybeStartDueTournaments
    const started = await startNotifs;
    assert(started.every((n) => n.type === 'inicio_torneo'), `los 4 deberian recibir 'inicio_torneo', vino ${JSON.stringify(started.map((n) => n.type))}`);
    console.log('inicio_torneo: los 4 participantes son notificados en vivo apenas el torneo auto-arranca (antes no pasaba NADA).');

    const event1 = (await getJson(`/api/events/${eventId}`)).data.event;
    const round1 = event1.bracket.rounds[0];
    assert(round1.matches.length === 2, `la ronda 1 deberia tener 2 partidos, hay ${round1.matches.length}`);

    async function waitMatchFinished(roundIndex, matchIndex, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ev = (await getJson(`/api/events/${eventId}`)).data.event;
        const status = ev.bracket.rounds[roundIndex]?.matches?.[matchIndex]?.status;
        if (status === 'finished' || status === 'bye') return true;
        await wait(200);
      }
      return false;
    }
    async function waitRoundAdvanced(roundIndex, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ev = (await getJson(`/api/events/${eventId}`)).data.event;
        if (ev.status === 'finished' || (ev.bracket?.rounds?.length || 0) > roundIndex + 1) return true;
        await wait(200);
      }
      return false;
    }

    // Ronda 1: p1 y p3 siempre ganan (p2/p4 se rinden), independiente
    // de como el auto-inicio mezclo el emparejamiento.
    const round1Winners = [];
    const round1Losers = [];
    for (let matchIndex = 0; matchIndex < round1.matches.length; matchIndex++) {
      const match = round1.matches[matchIndex];
      const s1 = socksByUsername[match.player1Name];
      const s2 = socksByUsername[match.player2Name];
      const ready1 = waitEvent(s1, 'game-start');
      s1.emit('tournament:join-match', { eventId, round: 0, matchIndex });
      const gs1 = await ready1;
      const ready2 = waitEvent(s2, 'game-start');
      s2.emit('tournament:join-match', { eventId, round: 0, matchIndex });
      await ready2;
      s2.emit('player-resign', { room: gs1.code, pgn: '' });
      assert(await waitMatchFinished(0, matchIndex), `partido ${matchIndex} de ronda 1 no termino`);
      round1Winners.push(match.player1Name);
      round1Losers.push(match.player2Name);
    }
    assert(await waitRoundAdvanced(0), 'el servidor no termino de avanzar el bracket tras la ronda 1');
    console.log(`Ronda 1 del torneo decidida: ganadores ${round1Winners.join(', ')}.`);

    // "torneo" (match listo): los 2 GANADORES de la ronda 1 deberian
    // haber recibido esto cuando se genero la ronda 2 -- se verifica
    // via el endpoint (persistente), no en vivo, porque el momento
    // exacto en que se genera la ronda 2 esta dentro del propio
    // resign de arriba (mas dificil de sincronizar con un listener).
    for (const winnerName of round1Winners) {
      const winnerToken = Object.values(p).find((pl) => pl.user.username === winnerName).token;
      const list = await getJson('/api/user/notifications', winnerToken);
      const hasMatchReady = list.data.notifications.some((n) => n.type === 'torneo');
      assert(hasMatchReady, `${winnerName} (gano la ronda 1) deberia tener una notificacion type 'torneo' (partido de ronda 2 listo), vino ${JSON.stringify(list.data.notifications.map((n) => n.type))}`);
    }
    console.log('torneo: los 2 ganadores de la ronda 1 quedan notificados de que su partido de ronda 2 ya esta listo (esto NO existia de ninguna forma antes de esta fase).');

    // "recompensa": primer_torneo para los 4 (jugar su primer partido).
    for (const key of Object.keys(p)) {
      const list = await getJson('/api/user/notifications', p[key].token);
      const hasFirstMatchReward = list.data.notifications.some((n) => n.type === 'recompensa');
      assert(hasFirstMatchReward, `${p[key].user.username} deberia tener al menos una notificacion 'recompensa' (primer_torneo), vino ${JSON.stringify(list.data.notifications.map((n) => n.type))}`);
    }
    console.log('recompensa: los 4 jugadores fueron notificados del premio "primer torneo" tras su primer partido.');

    // Ronda 2: decide al campeon.
    const event2 = (await getJson(`/api/events/${eventId}`)).data.event;
    const round2 = event2.bracket.rounds[1];
    const match2 = round2.matches[0];
    const s1 = socksByUsername[match2.player1Name];
    const s2 = socksByUsername[match2.player2Name];
    const ready1 = waitEvent(s1, 'game-start');
    s1.emit('tournament:join-match', { eventId, round: 1, matchIndex: 0 });
    const gs1 = await ready1;
    const ready2 = waitEvent(s2, 'game-start');
    s2.emit('tournament:join-match', { eventId, round: 1, matchIndex: 0 });
    await ready2;
    s2.emit('player-resign', { room: gs1.code, pgn: '' });
    assert(await waitMatchFinished(1, 0), 'la final del torneo no termino');
    await wait(500); // darle tiempo a coronar al campeon + otorgar los premios finales

    const finalEvent = (await getJson(`/api/events/${eventId}`)).data.event;
    assert(finalEvent.status === 'finished', `el torneo deberia terminar, quedo '${finalEvent.status}'`);
    const championName = finalEvent.bracket.championName;
    const runnerUpName = match2.player1Name === championName ? match2.player2Name : match2.player1Name;
    console.log(`Torneo terminado -- campeon: ${championName}, subcampeon: ${runnerUpName}.`);

    const championToken = Object.values(p).find((pl) => pl.user.username === championName).token;
    const championList = await getJson('/api/user/notifications', championToken);
    const championTitles = championList.data.notifications.filter((n) => n.type === 'recompensa').map((n) => n.title);
    assert(championTitles.some((t) => /campe/i.test(t)), `el campeon deberia tener una notificacion de recompensa mencionando "campeon", vino ${JSON.stringify(championTitles)}`);
    console.log('recompensa: el campeon fue notificado de su premio de campeon de torneo.');

    const runnerUpToken = Object.values(p).find((pl) => pl.user.username === runnerUpName).token;
    const runnerUpList = await getJson('/api/user/notifications', runnerUpToken);
    const runnerUpTitles = runnerUpList.data.notifications.filter((n) => n.type === 'recompensa').map((n) => n.title);
    assert(runnerUpTitles.some((t) => /finalista/i.test(t)), `el subcampeon deberia tener una notificacion de recompensa mencionando "finalista", vino ${JSON.stringify(runnerUpTitles)}`);
    console.log('recompensa: el subcampeon fue notificado de su premio de finalista.');

    console.log('\n✅ NOTIFICATIONS_FLOW_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('\n❌ NOTIFICATIONS_FLOW_FAILED:', err.message);
  process.exit(1);
});
