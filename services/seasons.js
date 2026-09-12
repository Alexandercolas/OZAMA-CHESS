'use strict';

// Temporadas (Fase 1, roadmap "OZAMA PRO - FASE FINAL"): ciclo
// completo y automatico -- inicio, duracion, cierre, clasificacion,
// recompensas, archivo y nueva temporada, para Ajedrez y Damas por
// separado. Reemplaza la version anterior (Fase I del roadmap PRO
// 2.0), que era PURA fecha calculada sin guardar nada en la base ni
// repartir premios -- eso quedaba pendiente a proposito hasta decidir
// estas reglas, que es exactamente lo que esta fase resuelve.
//
// Mismo principio que services/recurringTournaments.js: nunca un cron
// de verdad (Render puede reiniciar el proceso en cualquier momento,
// sin garantia de que un setInterval llegue a dispararse) -- en vez de
// eso, cada vez que un endpoint de alto trafico (leaderboard, /me,
// season-progress) se pide, se asegura que la temporada actual de cada
// juego exista y este al dia. maybeEnsureSeasons() tiene throttle en
// memoria para no pegarle a la base en cada request.
const Season = require('../models/Season');
const SeasonHistory = require('../models/SeasonHistory');
const Match = require('../models/Match');
const DamasMatch = require('../models/DamasMatch');
const User = require('../models/User');
const { grantAchievementReward } = require('./rewards');

// Configuracion central de duracion (seccion 2 del roadmap): un solo
// lugar, nunca disperso por el codigo. Cambiar esto SOLO afecta a la
// proxima temporada que se cree -- las que ya estan corriendo
// conservan su propia durationDays (ver models/Season.js), asi que
// ajustar este numero nunca corre las fechas de una temporada en
// curso.
const SEASON_DURATION_DAYS = 90;

const SEASON_CHAMPION_XP = 250;
const SEASON_TOP10_XP = 80;
const TOP10_CUTOFF = 10;
const TOP_STANDINGS_LIMIT = 20;

// Misma exclusion de cuentas de prueba/known-bad que
// publicLeaderboardFilter() en routes/user.js -- DUPLICADA a
// proposito en vez de importada: tests/readiness.test.js pin-ea la
// definicion original ahi mismo (verifica que la funcion viva en ese
// archivo, para no perder de vista esa guarda de seguridad), asi que
// moverla o re-exportarla desde ahi rompe ese test. Son 3 lineas; el
// costo de la duplicacion es menor que enredar routes/ <- services/.
function publicSeasonFilter() {
  return {
    isActive: true,
    username: { $nin: ['imgsrconeerror'], $not: /^sec[A-D]_\d{8}$/i },
  };
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function seasonSummary(season) {
  if (!season) return null;
  const now = Date.now();
  const daysRemaining = Math.max(0, Math.ceil((new Date(season.endsAt).getTime() - now) / 86400000));
  return {
    number: season.number,
    name: season.name,
    startsAt: season.startsAt,
    endsAt: season.endsAt,
    daysRemaining,
    status: season.status,
  };
}

// Clasificacion final de una temporada: solo cuentan jugadores con al
// menos 1 partida terminada DENTRO de la ventana de esa temporada
// (congela la puntuacion -- una partida jugada despues de endsAt ya
// pertenece a la siguiente). El "puntaje" para ordenar es el rating
// permanente actual (elo/damasElo) -- no se inventa un rating de
// temporada aparte; ver nota de diseño en el roadmap: separar
// PROGRESO de RATING, no crear un segundo rating.
async function computeStandings(season) {
  const eloField = season.game === 'damas' ? 'damasElo' : 'elo';
  const statsField = season.game === 'damas' ? 'damasStats' : 'stats';
  const Model = season.game === 'damas' ? DamasMatch : Match;

  const matches = await Model.find({
    endedAt: { $gte: season.startsAt, $lt: season.endsAt },
    result: { $in: ['white_win', 'black_win', 'draw'] },
  }).select('whitePlayer.userId blackPlayer.userId').lean();

  const participantIds = new Set();
  for (const m of matches) {
    if (m.whitePlayer?.userId) participantIds.add(String(m.whitePlayer.userId));
    if (m.blackPlayer?.userId) participantIds.add(String(m.blackPlayer.userId));
  }
  if (!participantIds.size) return [];

  const users = await User.find({ _id: { $in: [...participantIds] }, ...publicSeasonFilter() })
    .select(`username ${eloField} ${statsField}`)
    .sort({ [eloField]: -1 })
    .lean();

  return users.map((u, idx) => {
    const stats = u[statsField] || {};
    return {
      userId: u._id,
      username: u.username,
      rank: idx + 1,
      elo: u[eloField],
      wins: stats.wins || 0,
      losses: stats.losses || 0,
      draws: stats.draws || 0,
      games: (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0),
    };
  });
}

// Reparte premios (Fase 9: XP + logro -> el logro puede desbloquear un
// marco via services/cosmetics.js, sin sistema paralelo) y devuelve
// cada fila con su texto de recompensa ya resuelto, para guardar en
// SeasonHistory. grantAchievementReward() ya es idempotente por si
// closeSeason() se reintenta.
async function grantRewardsAndBuildHistory(season, standings) {
  const rows = [];
  for (const s of standings) {
    let reward = '';
    let xpAwarded = 0;
    if (s.rank === 1) {
      const key = season.game === 'damas' ? 'temporada_campeon_damas' : 'temporada_campeon_ajedrez';
      await grantAchievementReward(s.userId, key, SEASON_CHAMPION_XP);
      reward = 'Campeón de temporada + Marco + XP';
      xpAwarded = SEASON_CHAMPION_XP;
    } else if (s.rank <= TOP10_CUTOFF) {
      const key = season.game === 'damas' ? 'temporada_top10_damas' : 'temporada_top10_ajedrez';
      await grantAchievementReward(s.userId, key, SEASON_TOP10_XP);
      reward = 'Top 10 de temporada + XP';
      xpAwarded = SEASON_TOP10_XP;
    }
    rows.push({
      userId: s.userId, game: season.game, seasonNumber: season.number, seasonName: season.name,
      rank: s.rank, elo: s.elo, wins: s.wins, losses: s.losses, draws: s.draws, games: s.games,
      reward, xpAwarded,
    });
  }
  return rows;
}

// Margen de gracia antes de considerar que un cierre "en progreso"
// (status:'closing') en realidad quedo pegado por una caida del
// proceso, en vez de que otra llamada concurrente lo este resolviendo
// ahora mismo.
const CLOSING_STUCK_AFTER_MS = 2 * 60 * 1000;

async function finishClosing(claimed) {
  try {
    const standings = await computeStandings(claimed);
    const historyRows = await grantRewardsAndBuildHistory(claimed, standings);

    if (historyRows.length) {
      const writes = historyRows.map((row) => ({
        updateOne: {
          filter: { userId: row.userId, game: row.game, seasonNumber: row.seasonNumber },
          update: { $setOnInsert: { ...row, closedAt: new Date() } },
          upsert: true,
        },
      }));
      await SeasonHistory.bulkWrite(writes, { ordered: false });
    }

    await Season.updateOne({ _id: claimed._id }, {
      $set: {
        status: 'finished',
        closedAt: new Date(),
        totalParticipants: standings.length,
        topStandings: standings.slice(0, TOP_STANDINGS_LIMIT),
      },
    });
    console.log(`[Seasons] ${claimed.game} temporada ${claimed.number} cerrada: ${standings.length} participantes.`);
  } catch (err) {
    console.error(`[Seasons] Error cerrando ${claimed.game} temporada ${claimed.number}, se reintentara:`, err.message);
  }
}

// Cierra UNA temporada: reclamo atomico real -- SOLO el llamador que
// logra pisar status:'active' -> 'closing' hace el trabajo
// (clasificacion + premios + historial + status:'finished'). Si 5
// requests casi simultaneas ven la misma temporada vencida, 4 de ellas
// reciben null aca abajo y no hacen nada mas -- nunca recalculan ni
// reparten premios en paralelo (eso SI seria una carrera real, aunque
// los premios en si sean idempotentes). Si el proceso se cae a mitad
// de closeSeason(), la temporada queda en 'closing' con
// closingStartedAt viejo -- pasado el margen de gracia, la siguiente
// llamada la retoma desde cero (seguro: computeStandings/
// grantRewardsAndBuildHistory/SeasonHistory.bulkWrite son
// re-ejecutables sin duplicar nada).
async function closeSeason(season) {
  const claimed = await Season.findOneAndUpdate(
    { _id: season._id, status: 'active' },
    { $set: { status: 'closing', closingStartedAt: new Date() } },
    { new: true }
  );
  if (claimed) return finishClosing(claimed);

  const stuck = season.status === 'closing'
    && season.closingStartedAt
    && Date.now() - new Date(season.closingStartedAt).getTime() > CLOSING_STUCK_AFTER_MS;
  if (!stuck) return; // otro proceso la esta cerrando ahora mismo -- no pisarle el trabajo

  const resumed = await Season.findOneAndUpdate(
    { _id: season._id, status: 'closing', closingStartedAt: season.closingStartedAt },
    { $set: { closingStartedAt: new Date() } },
    { new: true }
  );
  if (resumed) return finishClosing(resumed);
}

// Asegura que la temporada activa de `game` este al dia: si la unica
// razon por la que no hay ninguna es que nunca se creo, arranca la
// #1 ahora mismo. Si la que estaba activa ya vencio (o quedo a medio
// cerrar en 'closing' de un intento anterior), la cierra y crea la
// siguiente. Es seguro llamarlo cualquier cantidad de veces seguidas:
// el indice unico {game,number} de Season rechaza (E11000) el segundo
// intento de crear la misma edicion si dos requests casi simultaneas
// llegan hasta aca a la vez.
async function ensureCurrentSeason(game) {
  const now = new Date();
  const latest = await Season.findOne({ game }).sort({ number: -1 });

  if (!latest) {
    try {
      await Season.create({
        game, number: 1, name: 'Temporada 1',
        startsAt: now, endsAt: addDays(now, SEASON_DURATION_DAYS),
        durationDays: SEASON_DURATION_DAYS, status: 'active',
      });
    } catch (err) {
      if (err.code !== 11000) throw err; // otra request ya la creo primero
    }
    return;
  }

  const needsClosing = latest.status === 'closing' || (latest.status === 'active' && latest.endsAt <= now);
  if (!needsClosing) return;

  await closeSeason(latest);

  try {
    await Season.create({
      game, number: latest.number + 1, name: `Temporada ${latest.number + 1}`,
      startsAt: latest.endsAt, endsAt: addDays(latest.endsAt, SEASON_DURATION_DAYS),
      durationDays: SEASON_DURATION_DAYS, status: 'active',
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
}

let _lastEnsureAt = 0;
const ENSURE_THROTTLE_MS = 5 * 60 * 1000;
async function maybeEnsureSeasons() {
  const now = Date.now();
  if (now - _lastEnsureAt < ENSURE_THROTTLE_MS) return;
  _lastEnsureAt = now;
  await Promise.all([ensureCurrentSeason('chess'), ensureCurrentSeason('damas')])
    .catch((err) => console.warn('[Seasons] ensureCurrentSeason:', err.message));
}

// Lectura para UI: la temporada activa de un juego, en el mismo shape
// que ya consumia el currentSeason() anterior ({number,name,
// startsAt,endsAt,daysRemaining}) + status, para que leaderboard.html/
// dashboard.html no necesiten cambiar nada.
async function getActiveSeason(game) {
  await maybeEnsureSeasons();
  const season = await Season.findOne({ game, status: { $in: ['active', 'closing'] } }).sort({ number: -1 }).lean();
  return seasonSummary(season);
}

// Progreso real de ESTA temporada (victorias/partidas desde que
// arranco) + posicion actual + mejor posicion historica + cuantas
// temporadas completo -- separado por juego, nunca mezclado. El ELO
// permanente (User.elo/damasElo) no se toca por nada de esto.
async function seasonProgressFor(userId, now = new Date()) {
  await maybeEnsureSeasons();

  async function forGame(game) {
    const season = await Season.findOne({ game, status: { $in: ['active', 'closing'] } }).sort({ number: -1 }).lean();
    if (!season) return { season: null, games: 0, wins: 0, bestRank: null, seasonsCompleted: 0 };

    const eloField = game === 'damas' ? 'damasElo' : 'elo';
    const statsField = game === 'damas' ? 'damasStats' : 'stats';
    const Model = game === 'damas' ? DamasMatch : Match;

    const [matches, user, history] = await Promise.all([
      Model.find({
        $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
        result: { $in: ['white_win', 'black_win', 'draw'] },
        endedAt: { $gte: season.startsAt, $lt: season.endsAt },
      }).select('whitePlayer.userId blackPlayer.userId result').lean(),
      User.findById(userId).select(eloField).lean(),
      SeasonHistory.find({ userId, game }).select('rank').lean(),
    ]);

    let games = 0, wins = 0;
    for (const m of matches) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      games++;
      if ((m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite)) wins++;
    }

    let myRank = null;
    if (user) {
      const ahead = await User.countDocuments({ ...publicSeasonFilter(), [eloField]: { $gt: user[eloField] } });
      myRank = ahead + 1;
    }

    const bestRank = history.length ? Math.min(...history.map((h) => h.rank)) : null;

    return {
      season: seasonSummary(season),
      games, wins, myRank, bestRank,
      seasonsCompleted: history.length,
    };
  }

  const [chess, damas] = await Promise.all([forGame('chess'), forGame('damas')]);
  // "season" a secas (sin sufijo de juego) se mantiene para
  // dashboard.html, que ya lo lee asi y muestra un resumen combinado
  // de los dos juegos -- en la practica ambas temporadas arrancan y
  // terminan juntas (ensureCurrentSeason corre para las dos a la vez),
  // asi que usar la de ajedrez como representativa es seguro.
  return { season: chess.season, chess, damas };
}

// Historial completo de temporadas ya cerradas para un usuario y
// juego (Fase 1: HISTORIAL -- "no borrar temporadas anteriores").
async function seasonHistoryFor(userId, game) {
  return SeasonHistory.find({ userId, game }).sort({ seasonNumber: -1 }).lean();
}

module.exports = {
  SEASON_DURATION_DAYS,
  ensureCurrentSeason,
  maybeEnsureSeasons,
  getActiveSeason,
  seasonProgressFor,
  seasonHistoryFor,
  // Exportado para tests (verificar cierre/idempotencia contra una
  // base aislada, sin esperar 90 dias de verdad).
  closeSeason,
  computeStandings,
};
