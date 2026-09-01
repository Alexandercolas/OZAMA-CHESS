'use strict';

// Eventos tematicos (Fase 12, roadmap "OZAMA PRO / Experiencia Final").
// Mismo principio de "calcular, nunca guardar" que ya usan
// services/recurringTournaments.js y services/weeklyChallenges.js: el
// evento se deriva de la fecha en cada llamada, nunca se persiste, asi
// que nunca se desincroniza ni depende de un cron/setInterval
// sobreviviendo un restart de Render.
//
// A diferencia de Torneos (con inscripcion/bracket) o Retos Semanales
// (con progreso guardado por usuario), un evento tematico es mas
// simple: una ventana de tiempo con un bono REAL de XP que se aplica
// automaticamente a toda partida jugada durante esa ventana -- no
// hace falta "unirse", alcanza con jugar. Este es, literalmente, el
// ejemplo que el roadmap pedia ("Fin de Semana de Blitz"). Antes esta
// fase se dejo afuera por no tener mecanica real detras -- esto es
// esa mecanica: el multiplicador de XP se aplica en
// applyProgressionForMatch() (server.js), no es solo un banner.
const WEEKEND_XP_MULTIPLIER = 1.5;

function activeThematicEvent(now = new Date()) {
  const day = now.getUTCDay(); // 0=domingo, 6=sabado
  if (day !== 6 && day !== 0) return null;

  // Ventana: sabado 00:00 UTC -> lunes 00:00 UTC (todo el fin de
  // semana completo, sin importar en que momento se entre).
  const endsAt = new Date(now);
  endsAt.setUTCHours(0, 0, 0, 0);
  endsAt.setUTCDate(endsAt.getUTCDate() + (day === 6 ? 2 : 1));

  return {
    key: 'blitz-weekend',
    name: 'Fin de Semana de Blitz',
    icon: '🔥',
    description: 'XP x1.5 en todas tus partidas de Ajedrez y Damas, todo el fin de semana.',
    xpMultiplier: WEEKEND_XP_MULTIPLIER,
    endsAt: endsAt.toISOString(),
  };
}

module.exports = { activeThematicEvent, WEEKEND_XP_MULTIPLIER };
