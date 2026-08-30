'use strict';
// Laboratorio de puzzles: carga el motor REAL (script.js + bot.js) en
// un sandbox de Node, arma posiciones a mano, y verifica mecanicamente
// que la solucion propuesta sea legal y realmente logre lo que dice
// (jaque mate / gana material) -- no se confia en la lectura humana
// del tablero, se corre contra el motor de verdad.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const fakeEl = () => ({ style: {}, classList: { toggle(){}, add(){}, remove(){}, contains: () => false }, addEventListener(){}, appendChild(){}, remove(){}, dataset: {}, textContent: '', innerHTML: '', value: '' });
const sessionStore = { 'ozama-bot-mode': 'true', 'ozama-bot-color': 'b' };
const sandbox = {
  console,
  document: { getElementById: () => fakeEl(), querySelectorAll: () => [], createElement: () => fakeEl(), body: fakeEl(), addEventListener(){} },
  sessionStorage: { getItem: (k) => sessionStore[k] ?? null, setItem(k,v){ sessionStore[k]=v; }, removeItem(){}, clear(){} },
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  navigator: { userAgent: 'node' },
  location: { href: '', replace(){}, assign(){} },
  setTimeout, clearTimeout, Math, Date, JSON, Promise,
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  Blob: function(){},
  addEventListener(){},
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);
const root = path.resolve(__dirname, '..', 'public');
vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), sandbox, { filename: 'script.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'bot.js'), 'utf8'), sandbox, { filename: 'bot.js' });

// script.js declara PIECE/COLOR/STATUS/etc con `const`/`function` de
// nivel superior -- eso crea bindings lexicos dentro del contexto del
// vm, NO propiedades del objeto sandbox. Para poder usarlos desde
// afuera hay que volver a evaluarlos DENTRO del contexto (asi vm los
// resuelve por su binding lexico) y capturar el valor de retorno.
const COLOR = vm.runInContext('COLOR', sandbox);
const PIECE = vm.runInContext('PIECE', sandbox);
const STATUS = vm.runInContext('STATUS', sandbox);
sandbox.getLegalMovesForSquare = vm.runInContext('getLegalMovesForSquare', sandbox);
sandbox.evaluateGameStatus = vm.runInContext('evaluateGameStatus', sandbox);

// rows[0] = fila 8 (negras) ... rows[7] = fila 1 (blancas). Mayuscula
// = blanca, minuscula = negra, '.' = vacio. Igual que un tablero FEN
// pero sin comprimir los numeros, para que sea facil de leer/editar.
const PIECE_FROM_LETTER = { p: PIECE.PAWN, n: PIECE.KNIGHT, b: PIECE.BISHOP, r: PIECE.ROOK, q: PIECE.QUEEN, k: PIECE.KING };
function parseBoard(rows) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const type = PIECE_FROM_LETTER[ch.toLowerCase()];
      const color = ch === ch.toUpperCase() ? COLOR.WHITE : COLOR.BLACK;
      board[r][c] = { type, color };
    });
  });
  return board;
}
function sq(alg) {
  const col = alg.charCodeAt(0) - 97;
  const row = 8 - Number(alg[1]);
  return { row, col };
}
function boardToText(board) {
  return board.map((row) => row.map((p) => {
    if (!p) return '.';
    const letters = { p:'p', n:'n', b:'b', r:'r', q:'q', k:'k' };
    const l = letters[p.type];
    return p.color === COLOR.WHITE ? l.toUpperCase() : l;
  }).join('')).join('\n');
}
function countMaterial(board, color) {
  const values = { p:1, n:3, b:3, r:5, q:9, k:0 };
  let total = 0;
  for (const row of board) for (const piece of row) if (piece && piece.color === color) total += values[piece.type];
  return total;
}

// Aplica una secuencia de jugadas {from,to,promotion} alternando
// turnos, verificando LEGALIDAD REAL en cada paso contra
// getLegalMovesForSquare. Devuelve {ok, board, turn, gsr, log} o
// {ok:false, error} si alguna jugada de la solucion no es legal.
function applySolution(rows, startTurn, solution) {
  let board = parseBoard(rows);
  let turn = startTurn === 'w' ? COLOR.WHITE : COLOR.BLACK;
  const gsr = { castlingRights: { w: { kingside: false, queenside: false }, b: { kingside: false, queenside: false } }, enPassantTarget: null };
  const log = [];

  for (const mv of solution) {
    const from = sq(mv.from);
    const to = sq(mv.to);
    const piece = board[from.row][from.col];
    if (!piece) return { ok: false, error: `No hay pieza en ${mv.from}` };
    if (piece.color !== turn) return { ok: false, error: `No es el turno de ${piece.color} para mover ${mv.from}` };

    const legal = sandbox.getLegalMovesForSquare(board, from.row, from.col, gsr);
    const match = legal.find((m) => m.row === to.row && m.col === to.col);
    if (!match) return { ok: false, error: `${mv.from}->${mv.to} NO es legal. Legales desde ${mv.from}: ${legal.map(m => String.fromCharCode(97+m.col)+(8-m.row)).join(',') || '(ninguna)'}` };

    // Aplicar la jugada a mano (captura, enroque, al paso, promocion)
    const captured = board[to.row][to.col];
    const epCaptured = match.enPassant && gsr.enPassantTarget ? board[from.row][gsr.enPassantTarget.col] : null;
    board[to.row][to.col] = piece;
    board[from.row][from.col] = null;
    if (match.castling === 'kingside') { board[from.row][5] = board[from.row][7]; board[from.row][7] = null; }
    if (match.castling === 'queenside') { board[from.row][3] = board[from.row][0]; board[from.row][0] = null; }
    if (match.enPassant && gsr.enPassantTarget) board[from.row][gsr.enPassantTarget.col] = null;
    gsr.enPassantTarget = (piece.type === PIECE.PAWN && Math.abs(to.row - from.row) === 2) ? { row: (from.row+to.row)/2, col: from.col } : null;
    if (mv.promotion && piece.type === PIECE.PAWN && (to.row === 0 || to.row === 7)) {
      board[to.row][to.col] = { type: mv.promotion, color: piece.color };
    }

    turn = turn === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
    const status = sandbox.evaluateGameStatus(board, turn, gsr);
    log.push({ move: `${mv.from}-${mv.to}`, captured: captured ? captured.type : (epCaptured ? epCaptured.type+'(ep)' : null), statusAfter: status });
  }

  return { ok: true, board, turn, gsr, log };
}

module.exports = { parseBoard, sq, boardToText, countMaterial, applySolution, STATUS, sandbox };
