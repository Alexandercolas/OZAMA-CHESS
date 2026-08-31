'use strict';

// Coleccion / cosmeticos (Fase 13 del roadmap PRO). A proposito NO es
// todavia una tienda con dinero real -- es un sistema de marcos de
// perfil que se DESBLOQUEAN jugando (nivel/logros ya existentes de la
// Fase 4), nunca comprables con plata. Ningun cosmetico da ninguna
// ventaja de juego -- son puramente visuales (mismo principio que ya
// aplica el plan Premium, ver el comentario en models/User.js).
//
// "Desbloqueado" se CALCULA siempre a partir del nivel/logros del
// usuario (nunca se guarda una lista aparte) para que nunca se
// desincronice -- ver isUnlocked().
// "rarity" (Fase 16, "OZAMA Torneos + Experiencia Visual"): etiqueta
// fija segun que tan dificil es conseguir cada marco -- es una
// decision de diseño, no un dato inventado sobre el usuario.
const FRAMES = [
  { key: 'ninguno', name: 'Sin marco', description: 'El aro dorado clasico de OZAMA.', unlock: { type: 'always' }, rarity: 'comun' },
  { key: 'bronce', name: 'Marco de Bronce', description: 'Alcanza nivel 3.', unlock: { type: 'level', value: 3 }, rarity: 'comun' },
  { key: 'plata', name: 'Marco de Plata', description: 'Alcanza nivel 6.', unlock: { type: 'level', value: 6 }, rarity: 'poco-comun' },
  { key: 'oro', name: 'Marco de Oro', description: 'Alcanza nivel 10.', unlock: { type: 'level', value: 10 }, rarity: 'raro' },
  { key: 'racha', name: 'Marco de Fuego', description: 'Logra el logro "Racha de Cinco".', unlock: { type: 'achievement', value: 'racha_cinco' }, rarity: 'raro' },
  { key: 'tactico', name: 'Marco de Laurel', description: 'Logra el logro "Mente Tactica" (10 puzzles resueltos).', unlock: { type: 'achievement', value: 'diez_acertijos' }, rarity: 'poco-comun' },
  { key: 'cazador', name: 'Marco de Cazador', description: 'Logra el logro "Caza Mayor" (gana a un rival de ELO mas alto).', unlock: { type: 'achievement', value: 'caza_mayor' }, rarity: 'epico' },
  { key: 'centenario', name: 'Marco de Roble', description: 'Logra el logro "Cien Partidas".', unlock: { type: 'achievement', value: 'cien_partidas' }, rarity: 'epico' },
  { key: 'campeon', name: 'Marco de Campeón', description: 'Gana un torneo de eliminación directa (logro "Campeón de Torneo").', unlock: { type: 'achievement', value: 'campeon_torneo' }, rarity: 'legendario' },
];

const FRAME_KEYS = new Set(FRAMES.map((f) => f.key));

function isUnlocked(frame, { level, achievementKeys }) {
  if (frame.unlock.type === 'always') return true;
  if (frame.unlock.type === 'level') return level >= frame.unlock.value;
  if (frame.unlock.type === 'achievement') return achievementKeys.has(frame.unlock.value);
  return false;
}

// Progreso real hacia un marco todavia bloqueado (Fase 14: "no
// inventar progreso, usar datos reales"). Solo se calcula para los
// logros donde existe un CONTADOR real y continuo -- racha_cinco
// (mejor racha de cualquiera de los dos juegos), diez_acertijos
// (puzzles resueltos, ajedrez + damas) y cien_partidas (partidas
// jugadas, ajedrez + damas). caza_mayor y campeon_torneo son eventos
// binarios (o pasaron o no) sin un numero real que mostrar como
// progreso -- para esos, progress queda null y la tarjeta se apoya
// solo en la descripcion, nunca se finge un porcentaje.
function progressFor(frame, user) {
  if (frame.unlock.type !== 'achievement') return null;
  const stats = user.stats || {};
  const damasStats = user.damasStats || {};
  switch (frame.unlock.value) {
    case 'racha_cinco':
      return { current: Math.max(stats.bestStreak || 0, damasStats.bestStreak || 0), target: 5 };
    case 'diez_acertijos':
      return { current: (user.puzzles?.totalSolved || 0) + (user.damasPuzzles?.totalSolved || 0), target: 10 };
    case 'cien_partidas': {
      const chessGames = (stats.wins || 0) + (stats.losses || 0) + (stats.draws || 0);
      const damasGames = (damasStats.wins || 0) + (damasStats.losses || 0) + (damasStats.draws || 0);
      return { current: chessGames + damasGames, target: 100 };
    }
    default:
      return null;
  }
}

// Lista de marcos con el estado de desbloqueo para ESTE usuario.
function framesFor(user, levelFromXp) {
  const level = levelFromXp(user.xp);
  const achievementKeys = new Set((user.achievements || []).map((a) => a.key));
  return FRAMES.map((f) => {
    const unlocked = isUnlocked(f, { level, achievementKeys });
    return {
      ...f,
      unlocked,
      equipped: (user.equippedFrame || 'ninguno') === f.key,
      // Para los que se desbloquean por nivel, el progreso es el
      // nivel mismo -- no necesita su propio caso en progressFor().
      progress: unlocked ? null : (f.unlock.type === 'level' ? { current: level, target: f.unlock.value } : progressFor(f, user)),
    };
  });
}

function isValidFrame(key) {
  return FRAME_KEYS.has(key);
}

module.exports = { FRAMES, isUnlocked, framesFor, isValidFrame };
