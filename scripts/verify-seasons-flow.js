'use strict';

// Prueba de punta a punta del ciclo de vida de temporadas (Fase 1 del
// roadmap "OZAMA PRO - FASE FINAL"): arranca una base de Mongo aislada
// y temporal (nunca produccion, mismo patron que scripts/test-db-
// guard.js), fabrica una temporada YA VENCIDA (no hay que esperar 90
// dias de verdad), la cierra llamando directo a services/seasons.js
// (sin levantar server.js -- este sistema no depende de sockets/HTTP),
// y verifica:
//
//   - clasificacion y premios correctos (campeon, top 10, sin premio
//     para el resto);
//   - el ELO PERMANENTE nunca se toca;
//   - se crea la siguiente temporada con las fechas correctas;
//   - llamar el cierre una segunda vez NO duplica nada (ni temporada,
//     ni premio, ni fila de historial);
//   - 5 llamadas CONCURRENTES cuando una temporada vence solo cierran/
//     crean una vez (protege contra la carrera real que puede pasar
//     con varios requests casi simultaneos en produccion);
//   - bootstrap: un juego sin ninguna temporada previa arranca la #1.
//
// Uso: node scripts/verify-seasons-flow.js

require('dotenv').config();
const mongoose = require('mongoose');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_seasons' });

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
  console.log(`DB=${isolatedMongo.dbName}`);

  const User = require('../models/User');
  const Match = require('../models/Match');
  const Season = require('../models/Season');
  const SeasonHistory = require('../models/SeasonHistory');
  const seasons = require('../services/seasons');

  try {
    // ── Fixture: 12 jugadores con ELO decreciente (rank 1..12) ──────
    const suffix = String(Date.now()).slice(-8);
    const users = [];
    for (let i = 0; i < 12; i++) {
      const u = await User.create({
        username: `season_p${i}_${suffix}`,
        email: `season_p${i}_${suffix}@example.test`,
        password: 'CorrectHorse99!',
        elo: 1500 - i * 10, // p0 tiene el elo mas alto -> rank 1
        stats: { wins: 5 - Math.floor(i / 3), losses: 1, draws: 0, streak: 0, bestStreak: 0 },
      });
      users.push(u);
    }

    const seasonStart = new Date(Date.now() - 91 * 86400000);
    const seasonEnd = new Date(Date.now() - 1 * 86400000); // ya vencio ayer

    // Cada jugador jugo (y termino) al menos 1 partida DENTRO de la
    // ventana de la temporada -- si no, no aparece en la clasificacion.
    for (const u of users) {
      await Match.create({
        roomCode: `S${u._id.toString().slice(-5)}`.toUpperCase(),
        whitePlayer: { userId: u._id, name: u.username, elo: u.elo },
        blackPlayer: { userId: null, name: 'Rival', elo: 1200 },
        result: 'white_win',
        winner: 'w',
        endedAt: new Date(seasonStart.getTime() + 86400000),
      });
    }

    await Season.create({
      game: 'chess', number: 1, name: 'Temporada 1',
      startsAt: seasonStart, endsAt: seasonEnd,
      durationDays: 90, status: 'active',
    });

    const eloBefore = new Map(users.map((u) => [String(u._id), u.elo]));

    // ── Cierre ───────────────────────────────────────────────────────
    await seasons.ensureCurrentSeason('chess');

    const s1 = await Season.findOne({ game: 'chess', number: 1 }).lean();
    assert(s1.status === 'finished', `temporada 1 deberia quedar 'finished', quedo '${s1.status}'`);
    assert(s1.totalParticipants === 12, `deberian ser 12 participantes, fueron ${s1.totalParticipants}`);
    assert(s1.topStandings.length === 12, `topStandings deberia tener 12 filas (limite 20), tiene ${s1.topStandings.length}`);
    assert(String(s1.topStandings[0].userId) === String(users[0]._id), 'rank 1 deberia ser el usuario de mayor ELO');
    console.log('Temporada 1 cerrada correctamente, clasificacion en orden de ELO.');

    const s2 = await Season.findOne({ game: 'chess', number: 2 }).lean();
    assert(s2, 'deberia existir la temporada 2');
    assert(s2.status === 'active', `temporada 2 deberia estar 'active', esta '${s2.status}'`);
    assert(new Date(s2.startsAt).getTime() === new Date(s1.endsAt).getTime(), 'temporada 2 deberia empezar justo donde termino la 1');
    assert(new Date(s2.endsAt).getTime() === new Date(s1.endsAt).getTime() + 90 * 86400000, 'temporada 2 deberia durar 90 dias');
    console.log('Temporada 2 creada automaticamente con las fechas correctas.');

    // ── ELO permanente: nunca se toca ───────────────────────────────
    for (const u of users) {
      const fresh = await User.findById(u._id).select('elo').lean();
      assert(fresh.elo === eloBefore.get(String(u._id)), `el ELO permanente de ${u.username} cambio (${eloBefore.get(String(u._id))} -> ${fresh.elo})`);
    }
    console.log('ELO permanente intacto para los 12 jugadores.');

    // ── Premios: campeon (rank 1), top 10 (rank 2-10), sin premio (11-12) ──
    const champion = await User.findById(users[0]._id).select('achievements xp').lean();
    assert(champion.achievements.some((a) => a.key === 'temporada_campeon_ajedrez'), 'el rank 1 deberia tener el logro de campeon de temporada');
    assert(champion.xp === 250, `el campeon deberia tener 250 XP, tiene ${champion.xp}`);

    const top10 = await User.findById(users[5]._id).select('achievements xp').lean(); // rank 6
    assert(top10.achievements.some((a) => a.key === 'temporada_top10_ajedrez'), 'un jugador rank 6 deberia tener el logro top10 de temporada');
    assert(top10.xp === 80, `un jugador top10 deberia tener 80 XP, tiene ${top10.xp}`);

    const rest = await User.findById(users[11]._id).select('achievements xp').lean(); // rank 12
    assert(!rest.achievements.some((a) => (a.key || '').startsWith('temporada_')), 'un jugador fuera del top 10 NO deberia tener logro de temporada');
    assert(rest.xp === 0, `un jugador sin premio no deberia tener XP de temporada, tiene ${rest.xp}`);
    console.log('Premios correctos: campeon, top 10, y sin premio para el resto.');

    // ── Historial: una fila por jugador, nunca duplicada ────────────
    let historyCount = await SeasonHistory.countDocuments({ game: 'chess', seasonNumber: 1 });
    assert(historyCount === 12, `deberian existir 12 filas de historial, hay ${historyCount}`);
    const champHistory = await SeasonHistory.findOne({ userId: users[0]._id, game: 'chess', seasonNumber: 1 }).lean();
    assert(champHistory.rank === 1 && champHistory.reward.includes('Campeón'), 'la fila de historial del campeon deberia reflejar rank 1 y el premio');
    console.log('Historial de temporada escrito correctamente (12 filas).');

    // ── Reintento: llamar el cierre de nuevo NO debe duplicar nada ──
    await seasons.ensureCurrentSeason('chess');
    const seasonCountAfterRetry = await Season.countDocuments({ game: 'chess' });
    assert(seasonCountAfterRetry === 2, `deberian seguir siendo 2 temporadas tras el reintento, hay ${seasonCountAfterRetry}`);
    const historyCountAfterRetry = await SeasonHistory.countDocuments({ game: 'chess', seasonNumber: 1 });
    assert(historyCountAfterRetry === 12, `el historial no deberia duplicarse tras el reintento, hay ${historyCountAfterRetry}`);
    const championAfterRetry = await User.findById(users[0]._id).select('xp').lean();
    assert(championAfterRetry.xp === 250, `el XP del campeon no deberia duplicarse tras el reintento, tiene ${championAfterRetry.xp}`);
    console.log('Reintento del cierre: idempotente, cero duplicados.');

    // ── Concurrencia: 5 llamadas simultaneas cuando la temporada 2 ──
    // vence -- solo debe crearse UNA temporada 3, nunca 5.
    await Season.updateOne({ game: 'chess', number: 2 }, { $set: { endsAt: new Date(Date.now() - 1000) } });
    await Promise.all(Array.from({ length: 5 }, () => seasons.ensureCurrentSeason('chess')));
    const season3Count = await Season.countDocuments({ game: 'chess', number: 3 });
    assert(season3Count === 1, `deberia existir exactamente 1 temporada 3 tras 5 llamadas concurrentes, hay ${season3Count}`);
    const totalChessSeasons = await Season.countDocuments({ game: 'chess' });
    assert(totalChessSeasons === 3, `deberian ser exactamente 3 temporadas de ajedrez en total, hay ${totalChessSeasons}`);
    console.log('Concurrencia: 5 llamadas simultaneas, cero duplicados.');

    // ── Bootstrap: Damas nunca tuvo una temporada -- arranca la #1 ──
    await seasons.ensureCurrentSeason('damas');
    const damasSeason1 = await Season.findOne({ game: 'damas', number: 1 }).lean();
    assert(damasSeason1 && damasSeason1.status === 'active', 'Damas deberia arrancar su propia temporada 1, independiente de Ajedrez');
    console.log('Bootstrap de Damas: temporada 1 creada de forma independiente.');

    console.log('\n✅ SEASONS_FLOW_OK');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ SEASONS_FLOW_FAILED:', err.message);
  process.exit(1);
});
