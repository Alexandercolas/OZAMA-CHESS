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
const FRAMES = [
  { key: 'ninguno', name: 'Sin marco', description: 'El aro dorado clasico de OZAMA.', unlock: { type: 'always' } },
  { key: 'bronce', name: 'Marco de Bronce', description: 'Alcanza nivel 3.', unlock: { type: 'level', value: 3 } },
  { key: 'plata', name: 'Marco de Plata', description: 'Alcanza nivel 6.', unlock: { type: 'level', value: 6 } },
  { key: 'oro', name: 'Marco de Oro', description: 'Alcanza nivel 10.', unlock: { type: 'level', value: 10 } },
  { key: 'racha', name: 'Marco de Fuego', description: 'Logra el logro "Racha de Cinco".', unlock: { type: 'achievement', value: 'racha_cinco' } },
  { key: 'tactico', name: 'Marco de Laurel', description: 'Logra el logro "Mente Tactica" (10 puzzles resueltos).', unlock: { type: 'achievement', value: 'diez_acertijos' } },
  { key: 'cazador', name: 'Marco de Cazador', description: 'Logra el logro "Caza Mayor" (gana a un rival de ELO mas alto).', unlock: { type: 'achievement', value: 'caza_mayor' } },
  { key: 'centenario', name: 'Marco de Roble', description: 'Logra el logro "Cien Partidas".', unlock: { type: 'achievement', value: 'cien_partidas' } },
  { key: 'campeon', name: 'Marco de Campeón', description: 'Gana un torneo de eliminación directa (logro "Campeón de Torneo").', unlock: { type: 'achievement', value: 'campeon_torneo' } },
];

const FRAME_KEYS = new Set(FRAMES.map((f) => f.key));

function isUnlocked(frame, { level, achievementKeys }) {
  if (frame.unlock.type === 'always') return true;
  if (frame.unlock.type === 'level') return level >= frame.unlock.value;
  if (frame.unlock.type === 'achievement') return achievementKeys.has(frame.unlock.value);
  return false;
}

// Lista de marcos con el estado de desbloqueo para ESTE usuario.
function framesFor(user, levelFromXp) {
  const level = levelFromXp(user.xp);
  const achievementKeys = new Set((user.achievements || []).map((a) => a.key));
  return FRAMES.map((f) => ({
    ...f,
    unlocked: isUnlocked(f, { level, achievementKeys }),
    equipped: (user.equippedFrame || 'ninguno') === f.key,
  }));
}

function isValidFrame(key) {
  return FRAME_KEYS.has(key);
}

module.exports = { FRAMES, isUnlocked, framesFor, isValidFrame };
