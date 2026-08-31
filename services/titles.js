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

module.exports = { GLOBAL_TITLES, titleForLevel };
