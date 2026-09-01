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
    rarity: 'comun',
    check: (ctx) => ctx.totalWins >= 1,
  },
  {
    key: 'diez_partidas',
    name: 'Diez Partidas',
    description: 'Juega 10 partidas.',
    icon: '♟️',
    rarity: 'comun',
    check: (ctx) => ctx.totalGames >= 10,
  },
  {
    key: 'cien_partidas',
    name: 'Cien Partidas',
    description: 'Juega 100 partidas.',
    icon: '💯',
    rarity: 'raro',
    check: (ctx) => ctx.totalGames >= 100,
  },
  {
    key: 'cincuenta_victorias',
    name: 'Cincuenta Victorias',
    description: 'Gana 50 partidas.',
    icon: '⚔️',
    rarity: 'raro',
    check: (ctx) => ctx.totalWins >= 50,
  },
  {
    key: 'racha_cinco',
    name: 'Racha de Cinco',
    description: 'Encadena 5 victorias seguidas.',
    icon: '🔥',
    rarity: 'poco-comun',
    check: (ctx) => ctx.bestStreak >= 5,
  },
  {
    key: 'racha_diez',
    name: 'Racha de Diez',
    description: 'Encadena 10 victorias seguidas.',
    icon: '🌋',
    rarity: 'epico',
    check: (ctx) => ctx.bestStreak >= 10,
  },
  {
    key: 'caza_mayor',
    name: 'Caza Mayor',
    description: 'Gana contra un rival de ELO mas alto que el tuyo.',
    icon: '🎯',
    rarity: 'epico',
    check: (ctx) => ctx.justWon && ctx.opponentEloWasHigher,
  },
  {
    key: 'victoria_relampago',
    name: 'Victoria Relámpago',
    description: 'Gana una partida de ajedrez en 15 jugadas o menos.',
    icon: '⚡',
    rarity: 'poco-comun',
    check: (ctx) => ctx.game === 'chess' && ctx.justWon && ctx.moveCount > 0 && ctx.moveCount <= 30,
  },
  {
    key: 'jugador_nocturno',
    name: 'Jugador Nocturno',
    description: 'Termina una partida entre la medianoche y las 5am.',
    icon: '🌙',
    rarity: 'comun',
    check: (ctx) => ctx.endHourUTC !== null && ctx.endHourUTC >= 0 && ctx.endHourUTC < 5,
  },
  {
    key: 'maratonista',
    name: 'Maratonista',
    description: 'Termina una partida de mas de 80 jugadas (ajedrez).',
    icon: '🏃',
    rarity: 'poco-comun',
    check: (ctx) => ctx.game === 'chess' && ctx.moveCount >= 80,
  },
  {
    key: 'primer_acertijo',
    name: 'Primer Acertijo',
    description: 'Resuelve tu primer puzzle tactico.',
    icon: '🧩',
    rarity: 'comun',
    check: (ctx) => ctx.totalPuzzlesSolved >= 1,
  },
  {
    key: 'diez_acertijos',
    name: 'Mente Tactica',
    description: 'Resuelve 10 puzzles tacticos.',
    icon: '🧠',
    rarity: 'poco-comun',
    check: (ctx) => ctx.totalPuzzlesSolved >= 10,
  },
  {
    key: 'cincuenta_acertijos',
    name: 'Maestro de la Tactica',
    description: 'Resuelve 50 puzzles tacticos.',
    icon: '🔮',
    rarity: 'raro',
    check: (ctx) => ctx.totalPuzzlesSolved >= 50,
  },
  {
    key: 'primera_coronacion',
    name: 'Primera Coronación',
    description: 'Corona una dama en Damas.',
    icon: '👑',
    rarity: 'comun',
    check: (ctx) => ctx.game === 'damas' && ctx.justPromoted,
  },
  {
    key: 'campeon_torneo',
    name: 'Campeón de Torneo',
    description: 'Gana un torneo de eliminación directa en OZAMA.',
    icon: '🎖️',
    rarity: 'legendario',
    // Este logro NO se detecta via check(ctx) -- coronarse campeon no
    // es algo que pase "durante" una partida individual, sino el
    // resultado de todo un bracket. Se otorga directo desde
    // handleTournamentMatchFinished() en server.js, en el mismo lugar
    // atomico (findOneAndUpdate con championId:null como guarda) donde
    // se corona al campeon -- asi nunca se duplica ni se le escapa a
    // checkNewAchievements().
    check: () => false,
  },
  {
    key: 'primer_torneo',
    name: 'Primer Torneo',
    description: 'Juega tu primera partida de torneo en OZAMA.',
    icon: '🎟️',
    rarity: 'comun',
    // Mismo motivo que campeon_torneo: se otorga directo desde
    // handleTournamentMatchFinished() (a AMBOS jugadores del partido,
    // ganen o pierdan), no via check(ctx).
    check: () => false,
  },
  {
    key: 'finalista_torneo',
    name: 'Finalista',
    description: 'Llega a la final de un torneo de OZAMA.',
    icon: '🥈',
    rarity: 'raro',
    // Igual: se otorga al perdedor del partido que decide el torneo,
    // desde handleTournamentMatchFinished().
    check: () => false,
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

// Progreso real hacia un logro todavia no desbloqueado (Fase 8,
// "OZAMA PRO / Experiencia Final" -- Coleccion, seccion Insignias).
// Mismo principio que services/cosmetics.js: solo los logros con un
// CONTADOR real y continuo tienen progreso -- el resto (caza_mayor,
// victoria_relampago, jugador_nocturno, maratonista,
// primera_coronacion, y los de torneo) son eventos puntuales sin un
// numero que mostrar, asi que devuelven null en vez de inventar un
// porcentaje. Los logros de partidas/racha se calculan por el MEJOR
// de los dos juegos (asi se desbloquean de verdad -- checkNewAchievements
// tambien evalua cada juego por separado, nunca sumados).
function achievementProgressFor(key, user) {
  const chess = user.stats || {};
  const damas = user.damasStats || {};
  const gamesOf = (s) => (s.wins || 0) + (s.losses || 0) + (s.draws || 0);
  const puzzlesSolved = (user.puzzles?.totalSolved || 0) + (user.damasPuzzles?.totalSolved || 0);
  switch (key) {
    case 'primera_victoria': return { current: Math.max(chess.wins || 0, damas.wins || 0), target: 1 };
    case 'cincuenta_victorias': return { current: Math.max(chess.wins || 0, damas.wins || 0), target: 50 };
    case 'diez_partidas': return { current: Math.max(gamesOf(chess), gamesOf(damas)), target: 10 };
    case 'cien_partidas': return { current: Math.max(gamesOf(chess), gamesOf(damas)), target: 100 };
    case 'racha_cinco': return { current: Math.max(chess.bestStreak || 0, damas.bestStreak || 0), target: 5 };
    case 'racha_diez': return { current: Math.max(chess.bestStreak || 0, damas.bestStreak || 0), target: 10 };
    case 'primer_acertijo': return { current: puzzlesSolved, target: 1 };
    case 'diez_acertijos': return { current: puzzlesSolved, target: 10 };
    case 'cincuenta_acertijos': return { current: puzzlesSolved, target: 50 };
    default: return null;
  }
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
function buildContext({ user, game, outcome, opponentElo, moveCount, endedAt, totalPuzzlesSolved, justPromoted }) {
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
    justPromoted: !!justPromoted,
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
  achievementProgressFor,
};
