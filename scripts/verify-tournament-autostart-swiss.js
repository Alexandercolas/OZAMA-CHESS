'use strict';

// Prueba de punta a punta de las dos piezas nuevas de Torneos PRO
// (Fase 3 del roadmap "OZAMA PRO"): auto-inicio real (antes de esta
// fase, NINGUN torneo arrancaba solo -- ni siquiera los recurrentes,
// siempre hacia falta que un admin generara el bracket a mano) y el
// formato Suizo (antes solo existia eliminacion directa). Levanta un
// server.js real contra una Mongo aislada y temporal (nunca
// produccion, mismo patron que scripts/verify-tournament-flow.js).
//
// Verifica:
//   - un torneo "published" con startsAt ya vencido y 2+ inscritos
//     arranca SOLO (bracket generado) con solo pedir GET /api/events,
//     sin ningun POST de admin;
//   - un torneo vencido con menos de 2 inscritos se cancela solo en
//     vez de quedar colgado para siempre;
//   - 5 llamadas concurrentes al auto-inicio solo arrancan el torneo
//     una vez (protege contra la misma carrera que ya se probo para
//     temporadas);
//   - Suizo con 4 jugadores: nadie queda eliminado al perder la
//     ronda 1, la ronda 2 empareja por puntaje evitando reencuentros,
//     y el campeon final es quien mas puntos acumulo en las 2 rondas
//     (no quien "sobrevivio" un bracket).
//
// Uso: node scripts/verify-tournament-autostart-swiss.js

require('dotenv').config();
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_TOURNAMENT_AUTOSTART_TEST_PORT || 3145);
const baseUrl = `http://127.0.0.1:${port}`;
// Prefijo corto a proposito: MongoDB limita el nombre de la base a 38
// bytes, y createIsolatedMongoEnv le suma "_" + 13 digitos de
// timestamp -- un prefijo largo como "ozama_test_tournament_auto" se
// pasa de esa cuenta y Mongo rechaza la conexion con un error dificil
// de asociar a esto (paso durante la autoria de esta prueba).
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_tauto' });

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

async function register(username, serverLines) {
  const res = await postJson('/api/auth/register', {
    username, email: `${username.toLowerCase()}@example.test`, password: 'CorrectHorse99!', country: 'DO',
  });
  if (res.status !== 201) {
    if (serverLines) console.error('--- server logs ---\n' + serverLines.slice(-40).join('\n'));
    throw new Error(`register ${username} failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
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

// Crea un torneo ya "vencido" (startsAt en el pasado) directamente por
// la API de admin -- el propio formulario de creacion no deja elegir
// una fecha pasada con naturalidad, pero el backend no lo prohibe (un
// torneo pensado para "hace un rato" es exactamente el caso de un
// proceso que se reinicio tarde), asi que es una forma valida de
// fabricar el escenario para la prueba.
async function createDueTournament(adminToken, { title, format, maxPlayers }) {
  const created = await postJson('/api/admin/events', {
    title, type: 'tournament', status: 'published', format, maxPlayers,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
  }, adminToken);
  if (created.status !== 201) throw new Error(`crear torneo "${title}" -> ${created.status} ${JSON.stringify(created.data)}`);
  return created.data.event._id;
}

async function resignInMatch(sock, roomCode) {
  sock.emit('player-resign', { room: roomCode, pgn: '' });
}

const serverLines = [];

async function main() {
  serverLines.length = 0;
  const adminSuffix = String(Date.now()).slice(-8);
  const adminUsername = `tauto_admin_${adminSuffix}`;
  const adminEmail = `${adminUsername.toLowerCase()}@example.test`;

  const proc = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      ...isolatedMongo.env,
      JWT_SECRET: process.env.JWT_SECRET || 'tournament-autostart-test-secret-at-least-32-chars',
      APP_ORIGINS: `${baseUrl},http://localhost:${port}`,
      GOOGLE_WEB_CLIENT_ID: '',
      GOOGLE_ANDROID_CLIENT_ID: '',
      GOOGLE_CLIENT_IDS: '',
      ADMIN_EMAILS: adminEmail,
      // Sin esto, el throttle real de 60s (routes/events.js) escondería
      // el auto-inicio de cada escenario siguiente durante todo ese
      // minuto -- ver el comentario junto a AUTOSTART_CHECK_INTERVAL_MS.
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

    const admin = await register(adminUsername, serverLines);

    // Solo 5 cuentas en TOTAL para todo el script (admin + 4
    // jugadores, reutilizados entre escenarios) -- el registro tiene
    // un rate limit real de 8 por 10 minutos por IP (bueno, no se
    // debilita para la prueba); crear una cuenta nueva por escenario
    // lo hubiera superado.
    const suffix = String(Date.now()).slice(-8);
    const p1 = await register(`tp1_${suffix}`);
    const p2 = await register(`tp2_${suffix}`);
    const p3 = await register(`tp3_${suffix}`);
    const p4 = await register(`tp4_${suffix}`);

    // ── Auto-inicio: torneo vencido con 2 inscritos arranca solo ───
    const soloEventId = await createDueTournament(admin.token, { title: 'Auto-inicio 2 jugadores', format: 'elimination', maxPlayers: 2 });
    await postJson(`/api/events/${soloEventId}/join`, {}, p1.token);
    await postJson(`/api/events/${soloEventId}/join`, {}, p2.token);

    // Tanto el listado (GET /api/events) como el detalle
    // (GET /api/events/:id) disparan maybeStartDueTournaments() --
    // pedir el detalle ya alcanza para que arranque solo, sin ningun
    // POST de admin.
    const afterAutostart = await getJson(`/api/events/${soloEventId}`);
    assert(afterAutostart.data.event.status === 'active', `el torneo deberia auto-arrancar a 'active', quedo '${afterAutostart.data.event.status}'`);
    assert(afterAutostart.data.event.bracket?.rounds?.length === 1, 'deberia tener la ronda 1 generada');
    console.log('Auto-inicio: torneo con 2 inscritos arranco solo con un simple GET, sin ningun POST de admin.');

    // ── Auto-cancelacion: torneo vencido con menos de 2 inscritos ──
    const emptyEventId = await createDueTournament(admin.token, { title: 'Auto-inicio sin gente', format: 'elimination', maxPlayers: 4 });
    await postJson(`/api/events/${emptyEventId}/join`, {}, p1.token);
    await getJson('/api/events');
    // Un torneo 'cancelled' ya no es visible por la API publica (por
    // diseño -- GET /api/events/:id solo muestra published/active/
    // finished), asi que se verifica por el listado de admin, que no
    // filtra por status.
    const adminEvents = await getJson('/api/admin/events', admin.token);
    const cancelledEvent = adminEvents.data.events.find((e) => e._id === emptyEventId);
    assert(cancelledEvent?.status === 'cancelled', `un torneo vencido con 1 solo inscrito deberia cancelarse solo, quedo '${cancelledEvent?.status}'`);
    console.log('Auto-cancelacion: torneo vencido con menos de 2 inscritos se cancelo solo (no quedo colgado).');

    // ── Concurrencia: 5 llamadas simultaneas solo arrancan una vez ──
    const raceEventId = await createDueTournament(admin.token, { title: 'Auto-inicio concurrente', format: 'elimination', maxPlayers: 2 });
    await postJson(`/api/events/${raceEventId}/join`, {}, p1.token);
    await postJson(`/api/events/${raceEventId}/join`, {}, p2.token);
    // El throttle de maybeStartDueTournaments es en memoria de PROCESO
    // (60s en produccion, bajado por OZAMA_AUTOSTART_THROTTLE_MS solo
    // aca) -- lo que de verdad prueba la concurrencia es el reclamo
    // atomico (findOneAndUpdate con status:'published' como guarda),
    // no el throttle en si: 5 llamadas simultaneas nunca deberian
    // producir 2 brackets.
    await Promise.all(Array.from({ length: 5 }, () => getJson(`/api/events/${raceEventId}`)));
    const racedEvent = await getJson(`/api/events/${raceEventId}`);
    assert(racedEvent.data.event.bracket?.rounds?.length === 1, `deberia haber exactamente 1 ronda tras 5 llamadas concurrentes, hay ${racedEvent.data.event.bracket?.rounds?.length}`);
    console.log('Concurrencia: 5 llamadas simultaneas al auto-inicio, el bracket no se duplico.');

    // ── Suizo con 4 jugadores ────────────────────────────────────────
    const swissEventId = await createDueTournament(admin.token, { title: 'Suizo de prueba', format: 'swiss', maxPlayers: 4 });
    const players = { p1, p2, p3, p4 };
    for (const key of Object.keys(players)) {
      await postJson(`/api/events/${swissEventId}/join`, {}, players[key].token);
    }
    await getJson('/api/events'); // auto-inicio
    let swissEvent = (await getJson(`/api/events/${swissEventId}`)).data.event;
    assert(swissEvent.status === 'active', `el suizo deberia auto-arrancar, quedo '${swissEvent.status}'`);
    assert(swissEvent.bracket.rounds.length === 1 && swissEvent.bracket.rounds[0].matches.length === 2, 'la ronda 1 del suizo deberia tener 2 partidos (4 jugadores)');
    console.log('Suizo: torneo de 4 jugadores auto-inicio con 2 partidos en la ronda 1.');

    // Conecta los 4 jugadores por socket y entra a su partido de la
    // ronda 1 -- se identifica cada jugador por userId, no por orden,
    // porque el emparejamiento de la ronda 1 se mezcla al azar.
    const socksByUsername = {};
    for (const key of Object.keys(players)) {
      const s = io(baseUrl, { auth: { token: players[key].token }, reconnection: false, timeout: 5000 });
      sockets.push(s);
      socksByUsername[players[key].user.username] = s;
      await waitEvent(s, 'connect');
    }

    // Espera de verdad a que el partido quede 'finished' en el bracket
    // (en vez de confiar ciegamente en un timeout fijo) -- si el
    // resign no se proceso server-side por lo que sea, esto lo dice
    // explicito en vez de dar un falso positivo.
    async function waitMatchFinished(roundIndex, matchIndex, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ev = (await getJson(`/api/events/${swissEventId}`)).data.event;
        const status = ev.bracket.rounds[roundIndex]?.matches?.[matchIndex]?.status;
        if (status === 'finished' || status === 'bye') return true;
        await wait(200);
      }
      return false;
    }

    // Que el ULTIMO partido de la ronda ya diga 'finished' no garantiza
    // que el servidor ya haya terminado de avanzar el bracket -- eso
    // pasa en awaits POSTERIORES dentro del mismo handler (otorgar
    // "primer torneo" a los dos jugadores, releer el evento, armar la
    // ronda siguiente). Hay que esperar a que ESO tambien termine antes
    // de leer bracket.rounds -- se confirma cuando aparece la ronda
    // siguiente o el torneo pasa a 'finished' (si esta era la ultima).
    async function waitRoundAdvanced(roundIndex, timeoutMs = 6000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ev = (await getJson(`/api/events/${swissEventId}`)).data.event;
        if (ev.status === 'finished' || (ev.bracket?.rounds?.length || 0) > roundIndex + 1) return true;
        await wait(200);
      }
      return false;
    }

    async function playRound(roundIndex) {
      const ev = (await getJson(`/api/events/${swissEventId}`)).data.event;
      const round = ev.bracket.rounds[roundIndex];
      const results = []; // { winnerUsername, loserUsername }
      for (let matchIndex = 0; matchIndex < round.matches.length; matchIndex++) {
        const match = round.matches[matchIndex];
        if (match.status === 'bye') { results.push({ winnerUsername: match.player1Name, loserUsername: null }); continue; }
        const s1 = socksByUsername[match.player1Name];
        const s2 = socksByUsername[match.player2Name];
        const ready1 = waitEvent(s1, 'game-start');
        s1.emit('tournament:join-match', { eventId: swissEventId, round: roundIndex, matchIndex });
        const gs1 = await ready1;
        const ready2a = waitEvent(s2, 'game-start');
        const ready2b = waitEvent(s1, 'game-start');
        s2.emit('tournament:join-match', { eventId: swissEventId, round: roundIndex, matchIndex });
        const [gs2, gs1b] = await Promise.all([ready2a, ready2b]);
        // p1 SIEMPRE gana (se rinde p2) -- asi el resultado de cada
        // ronda es predecible sin importar como mezclo el emparejamiento.
        void gs1b; void gs2;
        await resignInMatch(s2, gs1.code);
        const finished = await waitMatchFinished(roundIndex, matchIndex);
        assert(finished, `el partido ${match.player1Name} vs ${match.player2Name} (ronda ${roundIndex}) no quedo 'finished' tras el resign`);
        results.push({ winnerUsername: match.player1Name, loserUsername: match.player2Name });
      }
      const advanced = await waitRoundAdvanced(roundIndex);
      assert(advanced, `el servidor no termino de avanzar el bracket tras decidirse todos los partidos de la ronda ${roundIndex}`);
      return results;
    }

    const round1Results = await playRound(0);
    console.log(`Ronda 1 decidida: ${round1Results.map((r) => `${r.winnerUsername} > ${r.loserUsername || '(bye)'}`).join(', ')}`);

    swissEvent = (await getJson(`/api/events/${swissEventId}`)).data.event;
    if (swissEvent.bracket.rounds.length !== 2) {
      console.error('DEBUG round0 matches:', JSON.stringify(swissEvent.bracket.rounds[0].matches.map((m) => ({ p1: m.player1Name, p2: m.player2Name, status: m.status, winner: m.winner })), null, 2));
    }
    assert(swissEvent.bracket.rounds.length === 2, `deberia existir la ronda 2 del suizo, hay ${swissEvent.bracket.rounds.length} ronda(s)`);
    const round2 = swissEvent.bracket.rounds[1];
    const round1Winners = new Set(round1Results.map((r) => r.winnerUsername));
    const round1Losers = new Set(round1Results.map((r) => r.loserUsername).filter(Boolean));
    for (const m of round2.matches) {
      const bothWinners = round1Winners.has(m.player1Name) && round1Winners.has(m.player2Name);
      const bothLosers = round1Losers.has(m.player1Name) && round1Losers.has(m.player2Name);
      assert(bothWinners || bothLosers, `la ronda 2 del suizo deberia emparejar por puntaje (ganadores con ganadores, perdedores con perdedores), no "${m.player1Name}" vs "${m.player2Name}"`);
      const key = [m.player1Name, m.player2Name].sort().join('|');
      const alreadyPlayed = round1Results.some((r) => [r.winnerUsername, r.loserUsername].filter(Boolean).sort().join('|') === key);
      assert(!alreadyPlayed, `la ronda 2 no deberia repetir un enfrentamiento de la ronda 1 (${m.player1Name} vs ${m.player2Name}) habiendo alternativas`);
    }
    console.log('Ronda 2: empareja por puntaje (ganadores entre si, perdedores entre si) y evita reencuentros.');

    const round2Results = await playRound(1);
    console.log(`Ronda 2 decidida: ${round2Results.map((r) => `${r.winnerUsername} > ${r.loserUsername || '(bye)'}`).join(', ')}`);

    swissEvent = (await getJson(`/api/events/${swissEventId}`)).data.event;
    assert(swissEvent.status === 'finished', `el suizo deberia terminar tras 2 rondas (4 jugadores), quedo '${swissEvent.status}'`);
    const expectedChampion = round2Results.find((r) => round1Winners.has(r.winnerUsername))?.winnerUsername;
    assert(swissEvent.bracket.championName === expectedChampion, `el campeon deberia ser quien gano las 2 rondas (${expectedChampion}), salio "${swissEvent.bracket.championName}"`);
    console.log(`Suizo terminado correctamente tras 2 rondas -- campeon: ${swissEvent.bracket.championName} (2 puntos, nadie quedo eliminado por perder una ronda).`);

    console.log('\n✅ TOURNAMENT_AUTOSTART_SWISS_OK');
  } finally {
    for (const s of sockets) s.close();
    if (proc.exitCode === null) { proc.kill('SIGTERM'); await wait(300); if (proc.exitCode === null) proc.kill('SIGKILL'); }
  }
}

main().catch((err) => {
  console.error('--- server logs (todas) ---\n' + serverLines.join('\n'));
  console.error('\n❌ TOURNAMENT_AUTOSTART_SWISS_FAILED:', err.message);
  process.exit(1);
});
