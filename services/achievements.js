'use strict';

// Catalogo de logros (Fase 4 del roadmap PRO) -- un solo lugar, para
// poder sumar un logro nuevo agregando una entrada aca sin tocar el
// resto de la app. Cada logro define su propio check(ctx) -- ver
// buildContext() mas abajo para que trae 'ctx'.
//
// A proposito, solo hay logros que se pueden calcular con datos reales
// que YA se guardan (nunca se inventa una metrica). "Maestro de
// finales" o "victoria sin perder una pieza" quedaron afuera de este
// primer lote porque hoy no se persiste la posicion final ni las
// piezas capturadas por jugada -- se pueden sumar despues si se agrega
// ese tracking, sin romper nada de lo que ya existe aca.
const ACHIEVEMENTS = [
  {
    key: 'primera_victoria',
    name: 'Primera Victoria',
    description: 'Gana tu primera partida.',
    icon: '🏆',
    check: (ctx) => ctx.totalWins >= 1,
  },
  {
    key: 'diez_partidas',
    name: 'Diez Partidas',
    description: 'Juega 10 partidas.',
    icon: '♟️',
    check: (ctx) => ctx.totalGames >= 10,
  },
  {
    key: 'cien_partidas',
    name: 'Cien Partidas',
    description: 'Juega 100 partidas.',
    icon: '💯',
    check: (ctx) => ctx.totalGames >= 100,
  },
  {
    key: 'cincuenta_victorias',
    name: 'Cincuenta Victorias',
    description: 'Gana 50 partidas.',
    icon: '⚔️',
    check: (ctx) => ctx.totalWins >= 50,
  },
  {
    key: 'racha_cinco',
    name: 'Racha de Cinco',
    description: 'Encadena 5 victorias seguidas.',
    icon: '🔥',
    check: (ctx) => ctx.bestStreak >= 5,
  },
  {
    key: 'racha_diez',
    name: 'Racha de Diez',
    description: 'Encadena 10 victorias seguidas.',
    icon: '🌋',
    check: (ctx) => ctx.bestStreak >= 10,
  },
  {
    key: 'caza_mayor',
    name: 'Caza Mayor',
    description: 'Gana contra un rival de ELO mas alto que el tuyo.',
    icon: '🎯',
    check: (ctx) => ctx.justWon && ctx.opponentEloWasHigher,
  },
  {
    key: 'victoria_relampago',
    name: 'Victoria Relámpago',
    description: 'Gana una partida de ajedrez en 15 jugadas o menos.',
    icon: '⚡',
    check: (ctx) => ctx.game === 'chess' && ctx.justWon && ctx.moveCount > 0 && ctx.moveCount <= 30,
  },
  {
    key: 'jugador_nocturno',
    name: 'Jugador Nocturno',
    description: 'Termina una partida entre la medianoche y las 5am.',
    icon: '🌙',
    check: (ctx) => ctx.endHourUTC !== null && ctx.endHourUTC >= 0 && ctx.endHourUTC < 5,
  },
  {
    key: 'maratonista',
    name: 'Maratonista',
    description: 'Termina una partida de mas de 80 jugadas (ajedrez).',
    icon: '🏃',
    check: (ctx) => ctx.game === 'chess' && ctx.moveCount >= 80,
  },
  {
    key: 'primer_acertijo',
    name: 'Primer Acertijo',
    description: 'Resuelve tu primer puzzle tactico.',
    icon: '🧩',
    check: (ctx) => ctx.totalPuzzlesSolved >= 1,
  },
  {
    key: 'diez_acertijos',
    name: 'Mente Tactica',
    description: 'Resuelve 10 puzzles tacticos.',
    icon: '🧠',
    check: (ctx) => ctx.totalPuzzlesSolved >= 10,
  },
  {
    key: 'cincuenta_acertijos',
    name: 'Maestro de la Tactica',
    description: 'Resuelve 50 puzzles tacticos.',
    icon: '🔮',
    check: (ctx) => ctx.totalPuzzlesSolved >= 50,
  },
];

const ACHIEVEMENT_MAP = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

// XP: +10 por partida jugada, +15 extra si gano, +5 extra si empato --
// simple a proposito, se puede ajustar el balance despues sin romper
// nada (level() siempre deriva del total, nunca se guarda aparte).
function xpForResult(outcome) {
  const base = 10;
  if (outcome === 'win') return base + 15;
  if (outcome === 'draw') return base + 5;
  return base;
}

// XP por puzzle resuelto: base fija + un poco mas para los dificiles,
// para que igual valga la pena intentar los avanzados sin que un
// puzzle facil se sienta inutil.
function xpForPuzzle(difficulty) {
  const base = 8;
  const bonus = Math.max(0, Math.round((Number(difficulty || 800) - 800) / 100));
  return base + bonus;
}

function levelFromXp(xp) {
  return 1 + Math.floor(Number(xp || 0) / 100);
}

function xpIntoLevel(xp) {
  return Number(xp || 0) % 100;
}

// Arma el contexto que consumen los check() de arriba, a partir del
// User ya actualizado (stats/streak/elo ya deberian estar aplicados
// ANTES de llamar esto) y de datos puntuales de la partida que recien
// termino.
function buildContext({ user, game, outcome, opponentElo, moveCount, endedAt, totalPuzzlesSolved }) {
  const stats = game === 'damas' ? user.damasStats : user.stats;
  const totalWins = stats?.wins || 0;
  const totalGames = (stats?.wins || 0) + (stats?.losses || 0) + (stats?.draws || 0);
  const myElo = game === 'damas' ? user.damasElo : user.elo;
  return {
    game,
    totalWins,
    totalGames,
    bestStreak: stats?.bestStreak || 0,
    justWon: outcome === 'win',
    opponentEloWasHigher: typeof opponentElo === 'number' && opponentElo > myElo,
    moveCount: moveCount || 0,
    endHourUTC: endedAt ? new Date(endedAt).getUTCHours() : null,
    // Los logros de puzzles (primer_acertijo, etc.) son globales a
    // proposito -- no distinguen ajedrez de Damas, asi que suman los
    // dos catalogos salvo que el llamador pase un total ya calculado.
    totalPuzzlesSolved: totalPuzzlesSolved ?? ((user.puzzles?.totalSolved || 0) + (user.damasPuzzles?.totalSolved || 0)),
  };
}

// Devuelve las claves de logros nuevos (todavia no desbloqueados) que
// se cumplen con este contexto. No muta el usuario -- eso lo hace el
// llamador, junto con el resto de los cambios de la partida, para no
// sumar un save() extra.
function checkNewAchievements(user, ctx) {
  const already = new Set((user.achievements || []).map((a) => a.key));
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (already.has(achievement.key)) continue;
    try {
      if (achievement.check(ctx)) unlocked.push(achievement.key);
    } catch (_) { /* un logro roto no debe tumbar el cierre de partida */ }
  }
  return unlocked;
}

module.exports = {
  ACHIEVEMENTS,
  ACHIEVEMENT_MAP,
  xpForResult,
  xpForPuzzle,
  levelFromXp,
  xpIntoLevel,
  buildContext,
  checkNewAchievements,
};
