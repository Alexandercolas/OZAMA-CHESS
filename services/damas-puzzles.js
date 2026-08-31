'use strict';

// Catalogo de puzzles tacticos de Damas (Fase 10 del roadmap
// multijuego). Mismo espiritu que services/puzzles.js (ajedrez):
// cada posicion paso por scripts/_damas-puzzle-lab.js -- un arnes que
// carga el motor REAL de Damas (public/checkers-engine.js, el mismo
// que usan el tablero y el bot) y confirma a mano que la solucion
// propuesta es legal y logra exactamente lo que dice (cantidad de
// capturas / coronacion). Para agregar un puzzle nuevo: sumalo a
// scripts/_damas-puzzle-candidates.js, correlo, y si pasa, copialo aca.
//
// rows: 8 strings. rows[0] = fila 8 (arriba, hogar de negras) ...
// rows[7] = fila 1 (abajo, hogar de blancas). La LETRA (w/b) es el
// color; el CASO indica si es dama coronada ('W'/'B') o peon simple
// ('w'/'b'). '.' = vacio (incluye las casillas claras, que Damas no
// usa).
// solution: [{from,to}] -- 'to' es la casilla FINAL de la jugada (si
// es una captura multiple, el motor resuelve la cadena entera solo,
// igual que lo veria un jugador en el tablero).
const PUZZLES = [
  {
    key: 'captura-simple-1',
    category: 'captura',
    difficulty: 700,
    title: 'Captura obligatoria',
    description: 'Las blancas tienen una captura obligatoria disponible.',
    rows: [
      '........',
      '........',
      '........',
      '........',
      '...b....',
      '..w.....',
      '........',
      '........',
    ],
    turn: 'w',
    solution: [{ from: 'c3', to: 'e5' }],
  },
  {
    key: 'captura-multiple-1',
    category: 'captura-multiple',
    difficulty: 850,
    title: 'Doble captura',
    description: 'Las blancas encadenan dos capturas en una sola jugada.',
    rows: [
      '........',
      '........',
      '........',
      '....b...',
      '........',
      '..b.....',
      '.w......',
      '........',
    ],
    turn: 'w',
    solution: [{ from: 'b2', to: 'f6' }],
  },
  {
    key: 'coronacion-captura-1',
    category: 'coronacion',
    difficulty: 800,
    title: 'Captura y corona',
    description: 'Las blancas capturan y coronan en la misma jugada.',
    rows: [
      '........',
      '....b...',
      '...w....',
      '........',
      '........',
      '........',
      '........',
      '........',
    ],
    turn: 'w',
    solution: [{ from: 'd6', to: 'f8' }],
  },
  {
    key: 'coronacion-simple-1',
    category: 'coronacion',
    difficulty: 650,
    title: 'Corona sin captura',
    description: 'Las blancas avanzan a la ultima fila y coronan.',
    rows: [
      '........',
      '..w.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ],
    turn: 'w',
    solution: [{ from: 'c7', to: 'b8' }],
  },
  {
    key: 'captura-multiple-2',
    category: 'captura-multiple',
    difficulty: 1000,
    title: 'Triple captura',
    description: 'Las blancas encadenan tres capturas en una sola jugada.',
    rows: [
      '........',
      '........',
      '......b.',
      '........',
      '....b...',
      '........',
      '..b.....',
      '.w......',
    ],
    turn: 'w',
    solution: [{ from: 'b1', to: 'h7' }],
  },
  {
    key: 'dama-vuela-1',
    category: 'captura',
    difficulty: 900,
    title: 'La dama vuela',
    description: 'La dama blanca captura a distancia por la diagonal.',
    rows: [
      '........',
      '........',
      '........',
      '....b...',
      '........',
      '........',
      '........',
      'W.......',
    ],
    turn: 'w',
    solution: [{ from: 'a1', to: 'g7' }],
  },
];

const BY_KEY = new Map(PUZZLES.map((p) => [p.key, p]));
const BY_DIFFICULTY_ASC = [...PUZZLES].sort((a, b) => a.difficulty - b.difficulty);

function byKey(key) {
  return BY_KEY.get(key) || null;
}

function publicPuzzle(p) {
  if (!p) return null;
  const { key, category, difficulty, title, description, rows, turn } = p;
  return { key, category, difficulty, title, description, rows, turn };
}

function dailyPuzzleForDate(dateStr) {
  let hash = 0;
  // Semilla distinta a la de ajedrez (services/puzzles.js) para que el
  // desafio del dia de Damas no siempre "vaya de la mano" del de
  // ajedrez -- son catalogos y rotaciones independientes.
  const seeded = `damas:${dateStr}`;
  for (let i = 0; i < seeded.length; i++) hash = (hash * 31 + seeded.charCodeAt(i)) >>> 0;
  return PUZZLES[hash % PUZZLES.length];
}

function nextPracticePuzzle(solvedKeys) {
  const solved = new Set(solvedKeys || []);
  return BY_DIFFICULTY_ASC.find((p) => !solved.has(p.key)) || BY_DIFFICULTY_ASC[0];
}

function solutionMatches(puzzle, submittedMoves) {
  if (!Array.isArray(submittedMoves) || submittedMoves.length !== puzzle.solution.length) return false;
  return puzzle.solution.every((mv, i) => {
    const sub = submittedMoves[i];
    return sub && sub.from === mv.from && sub.to === mv.to;
  });
}

module.exports = { PUZZLES, byKey, publicPuzzle, dailyPuzzleForDate, nextPracticePuzzle, solutionMatches };
