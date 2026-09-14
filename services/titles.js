'use strict';

// Titulos de jugador (Fase D del roadmap PRO 2.0). El titulo GLOBAL
// (no depende de un juego especifico) se deriva del nivel -- que ya
// es un numero real, transparente y dificil de "gamear" con partidas
// repetitivas (level.js ya limita el XP por resultado, no por
// cantidad de clicks). No se inventa ningun titulo que dependa de
// datos que no se trackean (ej. "Maestro de Finales" pediria saber si
// una victoria fue en un final, y eso no se guarda hoy).
//
// Los titulos POR JUEGO ya existen -- son el rankTier() por ELO que
// ya calculaba routes/user.js (Aprendiz/Centinela/Maestro/Alcazar).
// Este archivo no los duplica, solo agrega la escalera global.
const GLOBAL_TITLES = [
  { minLevel: 30, name: 'Leyenda' },
  { minLevel: 20, name: 'Dominador' },
  { minLevel: 15, name: 'Veterano' },
  { minLevel: 10, name: 'Táctico' },
  { minLevel: 6,  name: 'Estratega' },
  { minLevel: 3,  name: 'Competidor' },
  { minLevel: 1,  name: 'Novato' },
];

function titleForLevel(level) {
  const lvl = Number(level) || 1;
  return (GLOBAL_TITLES.find((t) => lvl >= t.minLevel) || GLOBAL_TITLES[GLOBAL_TITLES.length - 1]).name;
}

// Titulos ESPECIALES (Fase 9, "Titulos y Rangos" -- el roadmap pide
// "titulos especiales obtenibles mediante: torneos; temporadas;
// logros; rendimiento", ademas de la escalera automatica de arriba).
// Reusa EXACTAMENTE los mismos logros que ya disparan un marco de
// perfil (services/cosmetics.js) -- no se inventa ningun logro nuevo
// solo para esto, y se importa isUnlocked() de ahi en vez de duplicar
// esa logica ("achievement" con value string o array, "level", etc.
// ya la resuelve). "ninguno" (default) nunca aparece en la lista:
// equipar "ninguno" es simplemente volver al titulo automatico por
// nivel, que ya existe siempre y no necesita desbloquearse.
const { isUnlocked } = require('./cosmetics');

const SPECIAL_TITLES = [
  { key: 'primer_torneo', name: 'Competidor de Torneo', description: 'Jugaste tu primera partida de torneo.', unlock: { type: 'achievement', value: 'primer_torneo' }, rarity: 'comun' },
  { key: 'finalista_torneo', name: 'Finalista', description: 'Llegaste a la final de un torneo.', unlock: { type: 'achievement', value: 'finalista_torneo' }, rarity: 'raro' },
  { key: 'campeon_torneo', name: 'Campeón de Torneo', description: 'Ganaste un torneo de eliminación directa.', unlock: { type: 'achievement', value: 'campeon_torneo' }, rarity: 'legendario' },
  { key: 'top10_temporada', name: 'Top 10 de Temporada', description: 'Terminaste entre los 10 primeros de una temporada.', unlock: { type: 'achievement', value: ['temporada_top10_ajedrez', 'temporada_top10_damas'] }, rarity: 'epico' },
  { key: 'campeon_temporada', name: 'Campeón de Temporada', description: 'Terminaste #1 en el ranking de una temporada.', unlock: { type: 'achievement', value: ['temporada_campeon_ajedrez', 'temporada_campeon_damas'] }, rarity: 'legendario' },
  // "rendimiento" (pedido explicito del roadmap, distinto de torneos/
  // temporadas/logros de cantidad): vencer a un rival de ELO mas alto.
  { key: 'cazador_gigantes', name: 'Cazador de Gigantes', description: 'Ganaste contra un rival de ELO mas alto que el tuyo.', unlock: { type: 'achievement', value: 'caza_mayor' }, rarity: 'epico' },
];
const SPECIAL_TITLE_KEYS = new Set(SPECIAL_TITLES.map((t) => t.key));

function isValidSpecialTitle(key) {
  return SPECIAL_TITLE_KEYS.has(key);
}

// Lista con el estado de desbloqueo/equipado para ESTE usuario --
// mismo shape que framesFor() en services/cosmetics.js.
function specialTitlesFor(user, levelFromXp) {
  const level = levelFromXp(user.xp);
  const achievementKeys = new Set((user.achievements || []).map((a) => a.key));
  return SPECIAL_TITLES.map((t) => ({
    ...t,
    unlocked: isUnlocked(t, { level, achievementKeys }),
    equipped: user.equippedTitle === t.key,
  }));
}

// El titulo global que se DEBE mostrar para este usuario ahora mismo:
// el especial que tenga equipado, SI todavia lo tiene desbloqueado
// (perder el logro nunca pasa hoy, pero la verificacion es gratis y
// evita mostrar algo que no se puede probar) -- si no, el automatico
// de siempre por nivel. Nunca rompe a nadie que no equipo ninguno.
function resolveGlobalTitle(user, levelFromXp) {
  if (user.equippedTitle) {
    const special = SPECIAL_TITLES.find((t) => t.key === user.equippedTitle);
    if (special) {
      const level = levelFromXp(user.xp);
      const achievementKeys = new Set((user.achievements || []).map((a) => a.key));
      if (isUnlocked(special, { level, achievementKeys })) return special.name;
    }
  }
  return titleForLevel(levelFromXp(user.xp));
}

module.exports = {
  GLOBAL_TITLES, titleForLevel,
  SPECIAL_TITLES, isValidSpecialTitle, specialTitlesFor, resolveGlobalTitle,
};
