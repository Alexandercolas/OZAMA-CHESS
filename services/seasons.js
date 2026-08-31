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

module.exports = { currentSeason, SEASON_LENGTH_DAYS };
