'use strict';
// Laboratorio de puzzles de Damas: igual en espiritu que
// scripts/_puzzle-lab.js (ajedrez), pero mas simple -- el motor de
// Damas (public/checkers-engine.js) ya es un modulo de Node puro, sin
// DOM, asi que no hace falta ningun sandbox de vm. Se arma una
// posicion a mano, se corre la solucion propuesta contra
// getLegalMovesForSquare/applyMove DE VERDAD, y se confirma que cada
// jugada es legal y logra lo que dice (captura(s) / coronacion).
const path = require('path');
const OzamaCheckers = require(path.join(__dirname, '..', 'public', 'checkers-engine.js'));

// rows[0] = fila 8 (arriba, hogar de negras) ... rows[7] = fila 1
// (abajo, hogar de blancas). 'w'/'b' = peon, 'W'/'B' = dama (coronada),
// '.' = vacio (incluye casillas claras, que nunca se usan).
function parseBoard(rows) {
  const board = OzamaCheckers.createInitialBoard().map((row) => row.map(() => null));
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === '.') return;
      // La LETRA (w/b) es el color; el CASO (mayus/minus) es si es
      // dama coronada ('W'/'B') o peon simple ('w'/'b').
      const color = ch.toLowerCase() === 'w' ? OzamaCheckers.COLOR.WHITE : OzamaCheckers.COLOR.BLACK;
      const king = ch === ch.toUpperCase();
      board[r][c] = { color, king };
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
    const letter = p.color === OzamaCheckers.COLOR.WHITE ? 'w' : 'b';
    return p.king ? letter.toUpperCase() : letter;
  }).join('')).join('\n');
}

function countPieces(board, color) {
  return OzamaCheckers.countPieces ? OzamaCheckers.countPieces(board, color)
    : board.flat().filter((p) => p && p.color === color).length;
}

// Aplica una secuencia de jugadas {from,to} alternando turnos. `to` es
// la casilla FINAL de la jugada (si es una captura multiple, el motor
// resuelve la cadena entera solo -- no hace falta listar cada salto
// intermedio, igual que como lo verian los jugadores en el tablero).
// Devuelve {ok, board, turn, log} o {ok:false, error} si alguna
// jugada de la solucion no es legal.
function applySolution(rows, startTurn, solution) {
  let board = parseBoard(rows);
  let turn = startTurn === 'w' ? OzamaCheckers.COLOR.WHITE : OzamaCheckers.COLOR.BLACK;
  const log = [];

  for (const mv of solution) {
    const from = sq(mv.from);
    const to = sq(mv.to);
    const piece = board[from.row][from.col];
    if (!piece) return { ok: false, error: `No hay pieza en ${mv.from}` };
    if (piece.color !== turn) return { ok: false, error: `No es el turno de ${piece.color} para mover ${mv.from}` };

    const sequences = OzamaCheckers.getLegalMovesForSquare(board, from.row, from.col);
    const match = sequences.find((seq) => {
      const last = seq[seq.length - 1];
      return last.toR === to.row && last.toC === to.col;
    });
    if (!match) {
      const legalTargets = sequences.map((seq) => {
        const last = seq[seq.length - 1];
        return String.fromCharCode(97 + last.toC) + (8 - last.toR);
      });
      return { ok: false, error: `${mv.from}->${mv.to} NO es legal. Destinos legales desde ${mv.from}: ${legalTargets.join(',') || '(ninguno)'}` };
    }

    const result = OzamaCheckers.applyMove(board, from.row, from.col, match);
    board = result.board;
    turn = OzamaCheckers.otherColor(turn);
    const over = OzamaCheckers.checkGameOver(board, turn);
    log.push({
      move: `${mv.from}-${mv.to}`,
      captured: result.captured.length,
      promoted: result.promoted,
      gameOver: over.over ? over : null,
    });
  }

  return { ok: true, board, turn, log };
}

module.exports = { OzamaCheckers, parseBoard, sq, boardToText, countPieces, applySolution };
