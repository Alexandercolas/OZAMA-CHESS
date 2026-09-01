'use strict';

// Retos Semanales (Fase 13, "OZAMA PRO / Experiencia Final"). A
// proposito NO incluye una meta de puzzles: el usuario solo tiene
// guardada la fecha del ULTIMO puzzle resuelto (lastSolvedDate), no
// un historial completo, asi que "resolvio 3 puzzles esta semana" no
// se puede calcular con datos reales sin agregar tracking nuevo.
// Mejor 2-3 metas reales que ninguna fabricada.
//
// Misma semana ISO simplificada que services/recurringTournaments.js
// (mismo lunes de referencia) -- si se cambia uno, hay que cambiar el
// otro para que sigan de acuerdo en que semana es "esta".
const Match = require('../models/Match');
const DamasMatch = require('../models/DamasMatch');

const MS_PER_DAY = 86400000;
const REF_MONDAY = new Date(Date.UTC(2026, 0, 5)); // lunes 5 ene 2026

function currentWeekRange(now = new Date()) {
  const weekIndex = Math.floor((now - REF_MONDAY) / (7 * MS_PER_DAY));
  const weekStart = new Date(REF_MONDAY.getTime() + weekIndex * 7 * MS_PER_DAY);
  const weekEnd = new Date(weekStart.getTime() + 7 * MS_PER_DAY);
  return { weekIndex, weekStart, weekEnd };
}

const WEEKLY_CHALLENGES = [
  { key: 'gana_3', name: 'Gana 3 Partidas', description: 'Gana 3 partidas esta semana, en Ajedrez o Damas.', icon: '🏆', target: 3 },
  { key: 'juega_5', name: 'Juega 5 Partidas', description: 'Juega 5 partidas esta semana, en Ajedrez o Damas.', icon: '♟️', target: 5 },
  { key: 'gana_damas', name: 'Prueba las Damas', description: 'Gana 1 partida de Damas esta semana.', icon: '⚫', target: 1 },
];

// Progreso real de los 3 retos para un usuario, en la semana actual.
// Una sola pasada por las partidas de la semana (Ajedrez + Damas) en
// vez de una consulta separada por reto.
async function weeklyProgressFor(userId, now = new Date()) {
  const { weekStart, weekEnd } = currentWeekRange(now);
  const filter = {
    $or: [{ 'whitePlayer.userId': userId }, { 'blackPlayer.userId': userId }],
    result: { $in: ['white_win', 'black_win', 'draw'] },
    endedAt: { $gte: weekStart, $lt: weekEnd },
  };
  const [chessMatches, damasMatches] = await Promise.all([
    Match.find(filter).select('whitePlayer.userId blackPlayer.userId result').lean(),
    DamasMatch.find(filter).select('whitePlayer.userId blackPlayer.userId result').lean(),
  ]);

  let totalGames = 0, totalWins = 0, damasWins = 0;
  for (const m of [...chessMatches, ...damasMatches]) {
    const isWhite = String(m.whitePlayer?.userId) === String(userId);
    const won = (m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite);
    totalGames++;
    if (won) totalWins++;
  }
  for (const m of damasMatches) {
    const isWhite = String(m.whitePlayer?.userId) === String(userId);
    const won = (m.result === 'white_win' && isWhite) || (m.result === 'black_win' && !isWhite);
    if (won) damasWins++;
  }

  const progressByKey = { gana_3: totalWins, juega_5: totalGames, gana_damas: damasWins };
  return WEEKLY_CHALLENGES.map((c) => ({
    key: c.key,
    name: c.name,
    description: c.description,
    icon: c.icon,
    current: Math.min(progressByKey[c.key] ?? 0, c.target),
    target: c.target,
    completed: (progressByKey[c.key] ?? 0) >= c.target,
  }));
}

module.exports = { WEEKLY_CHALLENGES, currentWeekRange, weeklyProgressFor };
