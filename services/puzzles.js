'use strict';

// Catalogo de puzzles tacticos (Fase 8 del roadmap PRO). Cada posicion
// de aca paso, antes de entrar a este archivo, por
// scripts/_puzzle-lab.js -- un arnes que carga el motor REAL del
// juego (el mismo getLegalMovesForSquare/evaluateGameStatus que corre
// en el tablero de verdad, no una reimplementacion) y confirma a mano
// que la solucion propuesta es legal y logra exactamente lo que dice
// (jaque mate / gana material). Para agregar un puzzle nuevo: sumalo
// a scripts/_puzzle-candidates.js, correlo, y si pasa, copialo aca.
//
// rows: 8 strings. rows[0] = fila 8 (negras) ... rows[7] = fila 1
// (blancas). Mayuscula = pieza blanca, minuscula = negra, '.' = vacio.
// solution: la UNICA secuencia de jugadas aceptada por ahora (todavia
// no se evaluan soluciones alternativas igual de buenas).
const PUZZLES = [
  {
    key: 'mate1-backrank',
    category: 'mate1',
    difficulty: 800,
    title: 'Mate de pasillo',
    description: 'Las blancas dan jaque mate en una jugada.',
    rows: [
      '......k.',
      '.....ppp',
      '........',
      '........',
      '........',
      '........',
      '........',
      '...R..K.',
    ],
    turn: 'w',
    solution: [{ from: 'd1', to: 'd8' }],
  },
  {
    key: 'mate1-smothered',
    category: 'mate1',
    difficulty: 1100,
    title: 'Mate sofocado',
    description: 'Las blancas dan jaque mate en una jugada.',
    rows: [
      '......rk',
      '......pp',
      '...N....',
      '........',
      '........',
      '........',
      '........',
      'K.......',
    ],
    turn: 'w',
    solution: [{ from: 'd6', to: 'f7' }],
  },
  {
    key: 'mate1-queen-support',
    category: 'mate1',
    difficulty: 900,
    title: 'Mate con apoyo de peón',
    description: 'Las blancas dan jaque mate en una jugada.',
    rows: [
      '.......k',
      '........',
      '......P.',
      '........',
      '........',
      '........',
      '........',
      'K......Q',
    ],
    turn: 'w',
    solution: [{ from: 'h1', to: 'h7' }],
  },
  {
    key: 'mate1-ladder-start',
    category: 'mate1',
    difficulty: 750,
    title: 'Torre en la octava',
    description: 'Las blancas dan jaque mate en una jugada.',
    rows: [
      'k.......',
      'ppp.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '...R.R.K',
    ],
    turn: 'w',
    solution: [{ from: 'f1', to: 'f8' }],
  },
  {
    key: 'mate1-box',
    category: 'mate1',
    difficulty: 850,
    title: 'Mate de la caja',
    description: 'Las blancas dan jaque mate en una jugada.',
    rows: [
      'k.......',
      '........',
      '.K......',
      '........',
      '........',
      '........',
      '........',
      '.......R',
    ],
    turn: 'w',
    solution: [{ from: 'h1', to: 'h8' }],
  },
  {
    key: 'fork1-knight-royal',
    category: 'fork',
    difficulty: 950,
    title: 'Horquilla de caballo',
    description: 'Las blancas juegan y ganan la torre con una horquilla.',
    rows: [
      'r...k...',
      '........',
      '........',
      '.N......',
      '........',
      '........',
      '........',
      '......K.',
    ],
    turn: 'w',
    solution: [{ from: 'b5', to: 'c7' }],
  },
  {
    key: 'fork2-knight-check',
    category: 'fork',
    difficulty: 1000,
    title: 'Horquilla con jaque',
    description: 'Las blancas juegan y ganan la dama con una horquilla.',
    rows: [
      '....k...',
      '........',
      'N.......',
      '...q....',
      '........',
      '........',
      '........',
      '....K...',
    ],
    turn: 'w',
    solution: [{ from: 'a6', to: 'c7' }],
  },
  {
    key: 'pin1-win-piece',
    category: 'pin',
    difficulty: 700,
    title: 'Clavada gana pieza',
    description: 'Las blancas juegan y ganan una pieza clavada.',
    rows: [
      '....k...',
      '........',
      '..n.....',
      '.B......',
      '........',
      '........',
      '........',
      '....K...',
    ],
    turn: 'w',
    solution: [{ from: 'b5', to: 'c6' }],
  },
];

const BY_KEY = new Map(PUZZLES.map((p) => [p.key, p]));
const BY_DIFFICULTY_ASC = [...PUZZLES].sort((a, b) => a.difficulty - b.difficulty);

function byKey(key) {
  return BY_KEY.get(key) || null;
}

// Version que se manda al cliente: nunca incluye la solucion.
function publicPuzzle(p) {
  if (!p) return null;
  const { key, category, difficulty, title, description, rows, turn } = p;
  return { key, category, difficulty, title, description, rows, turn };
}

// Puzzle del dia: deterministico por fecha (mismo puzzle para todo el
// mundo ese dia), rotando por el catalogo entero.
function dailyPuzzleForDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  return PUZZLES[hash % PUZZLES.length];
}

// Siguiente puzzle de practica para un usuario: el mas facil que
// todavia no resolvio. Si ya los resolvio todos, vuelve a ofrecer el
// mas facil (el catalogo esta pensado para crecer con el tiempo).
function nextPracticePuzzle(solvedKeys) {
  const solved = new Set(solvedKeys || []);
  return BY_DIFFICULTY_ASC.find((p) => !solved.has(p.key)) || BY_DIFFICULTY_ASC[0];
}

// Compara la solucion enviada por el cliente contra la guardada.
// Exacto a proposito -- cada puzzle de este catalogo ya paso por el
// arnes de verificacion, asi que la solucion guardada es la unica que
// hace falta aceptar.
function solutionMatches(puzzle, submittedMoves) {
  if (!Array.isArray(submittedMoves) || submittedMoves.length !== puzzle.solution.length) return false;
  return puzzle.solution.every((mv, i) => {
    const sub = submittedMoves[i];
    if (!sub || sub.from !== mv.from || sub.to !== mv.to) return false;
    if (mv.promotion && sub.promotion !== mv.promotion) return false;
    return true;
  });
}

module.exports = { PUZZLES, byKey, publicPuzzle, dailyPuzzleForDate, nextPracticePuzzle, solutionMatches };
