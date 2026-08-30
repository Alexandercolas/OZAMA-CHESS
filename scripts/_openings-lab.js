'use strict';
// Genera, para cada apertura del catalogo (services/openings.js), la
// posicion final tras jugar su linea principal -- reproduciendo cada
// jugada contra el motor REAL (mismo getLegalMovesForSquare que carga
// scripts/_puzzle-lab.js), no a mano. Si una jugada del catalogo
// resultara ilegal o ambigua, este script lo va a decir en vez de
// dejar pasar una posicion incorrecta al explorador de aperturas.
const { sandbox, sq, boardToText } = require('./_puzzle-lab');
const { OPENING_BOOK } = require('../services/openings');

const START_ROWS = [
  'rnbqkbnr',
  'pppppppp',
  '........',
  '........',
  '........',
  '........',
  'PPPPPPPP',
  'RNBQKBNR',
];

function parseBoard(rows) {
  const LETTER = { p:'p', n:'n', b:'b', r:'r', q:'q', k:'k' };
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      board[r][c] = { type: LETTER[ch.toLowerCase()], color: ch === ch.toUpperCase() ? 'w' : 'b' };
    });
  });
  return board;
}

function parseSAN(token) {
  const pieceLetters = { N: 'n', B: 'b', R: 'r', Q: 'q', K: 'k' };
  if (pieceLetters[token[0]]) return { pieceType: pieceLetters[token[0]], target: token.slice(1) };
  return { pieceType: 'p', target: token };
}

function applySAN(board, turn, gsr, token) {
  const { pieceType, target } = parseSAN(token);
  const to = sq(target);
  const candidates = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.color !== turn || p.type !== pieceType) continue;
      const legal = sandbox.getLegalMovesForSquare(board, r, c, gsr);
      if (legal.some((m) => m.row === to.row && m.col === to.col)) candidates.push({ row: r, col: c });
    }
  }
  if (candidates.length !== 1) throw new Error(`${token}: ${candidates.length} candidatos (se esperaba 1)`);
  const from = candidates[0];
  const piece = board[from.row][from.col];
  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;
  gsr.enPassantTarget = (piece.type === 'p' && Math.abs(to.row - from.row) === 2)
    ? { row: (from.row + to.row) / 2, col: from.col } : null;
  return turn === 'w' ? 'b' : 'w';
}

function finalRowsFor(moves) {
  const board = parseBoard(START_ROWS);
  let turn = 'w';
  const gsr = { castlingRights: { w: { kingside: false, queenside: false }, b: { kingside: false, queenside: false } }, enPassantTarget: null };
  for (const token of moves) turn = applySAN(board, turn, gsr, token);
  return board.map((row) => row.map((p) => {
    if (!p) return '.';
    return p.color === 'w' ? p.type.toUpperCase() : p.type;
  }).join(''));
}

let failed = 0;
const results = [];
for (const entry of OPENING_BOOK) {
  try {
    const rows = finalRowsFor(entry.moves);
    results.push({ name: entry.name, rows });
    console.log(`✅ ${entry.name}: ${entry.moves.join(' ')}`);
    console.log(boardToText(parseBoard(rows)));
  } catch (err) {
    failed++;
    console.log(`❌ ${entry.name}: ${err.message}`);
  }
}
console.log(`\n${results.length}/${OPENING_BOOK.length} aperturas resueltas contra el motor real.`);
console.log('\nJSON:');
console.log(JSON.stringify(results));
