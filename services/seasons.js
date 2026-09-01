'use strict';

// Temporadas (Fase I, roadmap PRO 2.0). Por decision explicita del
// usuario, esto es SOLO arquitectura visible por ahora: un nombre y
// una fecha de cierre que se muestran en el ranking. A proposito NO
// reinicia el ELO ni otorga recompensas -- eso queda pendiente para
// una fase futura, una vez que se decidan las reglas (¿se resetea el
// ELO? ¿se comprime hacia la media? ¿que pasa con el historial?).
//
// La temporada se CALCULA a partir de la fecha (nunca se guarda en la
// DB) para que nunca se desincronice -- mismo principio que ya usa
// services/cosmetics.js para "desbloqueado".
const SEASON_LENGTH_DAYS = 90;
const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const MS_PER_DAY = 86400000;

function currentSeason(now = new Date()) {
  const daysSinceEpoch = Math.floor((now - EPOCH) / MS_PER_DAY);
  const seasonIndex = Math.max(0, Math.floor(daysSinceEpoch / SEASON_LENGTH_DAYS));
  const startsAt = new Date(EPOCH.getTime() + seasonIndex * SEASON_LENGTH_DAYS * MS_PER_DAY);
  const endsAt = new Date(startsAt.getTime() + SEASON_LENGTH_DAYS * MS_PER_DAY);
  const daysRemaining = Math.max(0, Math.ceil((endsAt - now) / MS_PER_DAY));
  return {
    number: seasonIndex + 1,
    name: `Temporada ${seasonIndex + 1}`,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    daysRemaining,
  };
}

// Fase 23 (roadmap "OZAMA PRO / Experiencia Final"): "separar el
// rating permanente del progreso de temporada". Sin reglas de reset
// de ELO todavia definidas, lo unico que se puede construir con datos
// reales es un CONTADOR de la temporada (victorias/partidas desde que
// arranco), nunca un rating nuevo -- el ELO real (User.elo) sigue
// siendo el unico rating que existe. Mismo patron de rango de fechas
// que weeklyProgressFor() en services/weeklyChallenges.js.
const Match = require('../models/Match');
const DamasMatch = require('../models/DamasMatch');

async function seasonProgressFor(userId, now = new Date()) {
  const season = currentSeason(now);
  const seasonStart = new Date(season.startsAt);
  const filter = {
    $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
    result: { $in: ['white_win', 'black_win', 'draw'] },
    endedAt: { $gte: seasonStart },
  };

  const [chessMatches, damasMatches] = await Promise.all([
    Match.find(filter).select('whitePlayer.userId blackPlayer.userId result').lean(),
    DamasMatch.find(filter).select('whitePlayer.userId blackPlayer.userId result').lean(),
  ]);

  function tally(matches) {
    let games = 0, wins = 0;
    for (const m of matches) {
      const isWhite = String(m.whitePlayer?.userId) === String(userId);
      const won = (m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite);
      games++;
      if (won) wins++;
    }
    return { games, wins };
  }

  return {
    season: { number: season.number, name: season.name, daysRemaining: season.daysRemaining },
    chess: tally(chessMatches),
    damas: tally(damasMatches),
  };
}

module.exports = { currentSeason, seasonProgressFor, SEASON_LENGTH_DAYS };
