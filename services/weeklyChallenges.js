'use strict';

// Retos Semanales (Fase 13, "OZAMA PRO / Experiencia Final"). La meta
// de puzzles ("Resuelve 3 Acertijos", Fase 13 "Misiones" del roadmap
// OZAMA PRO) quedo afuera originalmente porque el usuario solo tenia
// guardada la fecha del ULTIMO puzzle resuelto (lastSolvedDate), no un
// contador semanal real -- User.weeklyPuzzlesSolved (models/User.js)
// suma exactamente eso ahora, incrementado desde routes/puzzles.js y
// routes/damas-puzzles.js en el mismo lugar donde ya suman
// totalSolved, asi que el reto de aca abajo tampoco fabrica un numero.
//
// Misma semana ISO simplificada que services/recurringTournaments.js
// (mismo lunes de referencia) -- si se cambia uno, hay que cambiar el
// otro para que sigan de acuerdo en que semana es "esta".
const Match = require('../models/Match');
const DamasMatch = require('../models/DamasMatch');
const { notify } = require('./notifications');

const MS_PER_DAY = 86400000;
const REF_MONDAY = new Date(Date.UTC(2026, 0, 5)); // lunes 5 ene 2026

function currentWeekRange(now = new Date()) {
  const weekIndex = Math.floor((now - REF_MONDAY) / (7 * MS_PER_DAY));
  const weekStart = new Date(REF_MONDAY.getTime() + weekIndex * 7 * MS_PER_DAY);
  const weekEnd = new Date(weekStart.getTime() + 7 * MS_PER_DAY);
  return { weekIndex, weekStart, weekEnd };
}

// `xp`: bono de XP al completar (Fase 12, "Recompensas" -- unifica el
// otorgamiento con el mismo patron que ya usan torneos/temporadas/
// logros via services/rewards.js). Montos deliberadamente chicos frente
// a TOURNAMENT_CHAMPION_XP=200/SEASON_CHAMPION_XP=250 en server.js/
// seasons.js: esto se puede reclamar cada semana, no es un logro unico.
const WEEKLY_CHALLENGES = [
  { key: 'gana_3', name: 'Gana 3 Partidas', description: 'Gana 3 partidas esta semana, en Ajedrez o Damas.', icon: '🏆', target: 3, xp: 30 },
  { key: 'juega_5', name: 'Juega 5 Partidas', description: 'Juega 5 partidas esta semana, en Ajedrez o Damas.', icon: '♟️', target: 5, xp: 20 },
  { key: 'gana_damas', name: 'Prueba las Damas', description: 'Gana 1 partida de Damas esta semana.', icon: '⚫', target: 1, xp: 20 },
  { key: 'resuelve_puzzles', name: 'Resuelve 3 Acertijos', description: 'Resuelve 3 puzzles tacticos esta semana, de Ajedrez o Damas.', icon: '🧩', target: 3, xp: 25 },
];

// Progreso real de los 4 retos para un usuario, en la semana actual.
// Una sola pasada por las partidas de la semana (Ajedrez + Damas) en
// vez de una consulta separada por reto. `weeklyPuzzlesSolved` es el
// campo crudo del usuario (User.weeklyPuzzlesSolved) -- lo pasa el
// llamador (ya tiene el documento cargado) en vez de que esta funcion
// haga su propia consulta aparte solo para ese numero.
async function weeklyProgressFor(userId, now = new Date(), weeklyPuzzlesSolved = null) {
  const { weekIndex, weekStart, weekEnd } = currentWeekRange(now);
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

  const puzzlesSolvedThisWeek = weeklyPuzzlesSolved && weeklyPuzzlesSolved.weekIndex === weekIndex
    ? Number(weeklyPuzzlesSolved.count || 0)
    : 0;
  const progressByKey = { gana_3: totalWins, juega_5: totalGames, gana_damas: damasWins, resuelve_puzzles: puzzlesSolvedThisWeek };
  return WEEKLY_CHALLENGES.map((c) => ({
    key: c.key,
    name: c.name,
    description: c.description,
    icon: c.icon,
    xp: c.xp,
    current: Math.min(progressByKey[c.key] ?? 0, c.target),
    target: c.target,
    completed: (progressByKey[c.key] ?? 0) >= c.target,
  }));
}

// Otorga el bono de XP de cada reto semanal recien completado (Fase
// 12, "Recompensas"): el progreso arriba se recalcula en vivo y NUNCA
// se guarda, asi que hace falta este registro aparte (claimedKeys) para
// no volver a sumar el mismo XP cada vez que se pide el progreso. Si la
// semana actual cambio desde el ultimo reclamo, claimedKeys se vacia
// sola -- misma idea que lastDailyDate en los puzzles, sin cron.
// Muta y GUARDA `user` si otorgo algo; el llamador (routes/user.js) ya
// tiene el documento cargado de todas formas para la respuesta.
async function claimWeeklyRewards(user, challenges, io = null) {
  const { weekIndex } = currentWeekRange();
  const current = user.weeklyChallenges && user.weeklyChallenges.weekIndex === weekIndex
    ? user.weeklyChallenges
    : { weekIndex, claimedKeys: [] };
  const claimed = new Set(current.claimedKeys || []);

  let changed = false;
  for (const c of challenges) {
    if (c.completed && !claimed.has(c.key)) {
      user.xp = Number(user.xp || 0) + c.xp;
      claimed.add(c.key);
      changed = true;
      if (io) {
        // 'mision' (no 'recompensa'): tipo dedicado que ya vivia en el
        // enum de models/Notification.js sin ningun disparador todavia
        // -- este es exactamente el caso para el que se reservo.
        notify(io, user._id, {
          type: 'mision',
          icon: c.icon,
          title: `Reto semanal completado: ${c.name}`,
          body: `+${c.xp} XP`,
          link: '/dashboard.html',
        });
      }
    }
  }

  if (changed) {
    user.weeklyChallenges = { weekIndex, claimedKeys: [...claimed] };
    await user.save();
  }
  return [...claimed];
}

// Suma 1 al contador semanal de puzzles resueltos (Fase 13,
// "Misiones") -- llamado desde routes/puzzles.js y
// routes/damas-puzzles.js en el mismo lugar donde ya suman
// totalSolved (misma condicion: no cuenta el desafio del dia repetido
// el mismo dia). Muta `user` en memoria; el `await user.save()` que
// YA hace cada una de esas rutas al final persiste esto tambien, sin
// un save() aparte.
function bumpWeeklyPuzzleSolved(user, now = new Date()) {
  const { weekIndex } = currentWeekRange(now);
  if (!user.weeklyPuzzlesSolved || user.weeklyPuzzlesSolved.weekIndex !== weekIndex) {
    user.weeklyPuzzlesSolved = { weekIndex, count: 0 };
  }
  user.weeklyPuzzlesSolved.count = Number(user.weeklyPuzzlesSolved.count || 0) + 1;
}

module.exports = { WEEKLY_CHALLENGES, currentWeekRange, weeklyProgressFor, claimWeeklyRewards, bumpWeeklyPuzzleSolved };
