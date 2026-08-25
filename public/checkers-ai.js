'use strict';

// ================================================================
// OZAMA CHESS - Bot de Damas (minimax + poda alfa-beta)
// ================================================================
// Sincrono y de un solo hilo -- para un tablero 8x8 de Damas con
// captura obligatoria (que reduce mucho el factor de ramificacion en
// posiciones tacticas) una profundidad de 4-6 plies corre en
// milisegundos en cualquier telefono moderno. Si mas adelante hace
// falta mas fuerza, este mismo modulo se puede mover a un Web Worker
// sin cambiar la API publica.

(function () {
  const E = window.OzamaCheckers;
  if (!E) throw new Error('checkers-ai.js requiere que checkers-engine.js se cargue primero.');

  const MAN_VALUE = 100;
  const KING_VALUE = 170;
  const CENTER_BONUS = 4;

  function flattenMoves(board, color) {
    const entries = E.getAllLegalMoves(board, color);
    const moves = [];
    for (const entry of entries) {
      for (const seq of entry.sequences) {
        moves.push({ r: entry.r, c: entry.c, seq });
      }
    }
    return moves;
  }

  function evaluate(board, forColor) {
    const other = E.otherColor(forColor);
    let score = 0;
    let mobilityFor = 0;
    let mobilityAgainst = 0;

    for (let r = 0; r < E.SIZE; r++) {
      for (let c = 0; c < E.SIZE; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        let value = piece.king ? KING_VALUE : MAN_VALUE;
        // Bonus pequeno por controlar el centro del tablero (mas movilidad futura).
        if (r >= 2 && r <= 5 && c >= 2 && c <= 5) value += CENTER_BONUS;
        score += piece.color === forColor ? value : -value;
      }
    }

    mobilityFor = flattenMoves(board, forColor).length;
    mobilityAgainst = flattenMoves(board, other).length;
    score += (mobilityFor - mobilityAgainst) * 2;

    return score;
  }

  function minimax(board, colorToMove, depth, alpha, beta, forColor) {
    const status = E.checkGameOver(board, colorToMove);
    if (status.over) {
      if (status.winner === forColor) return 100000 + depth;
      if (status.winner === null) return 0;
      return -100000 - depth;
    }
    if (depth === 0) return evaluate(board, forColor);

    const moves = flattenMoves(board, colorToMove);
    const maximizing = colorToMove === forColor;
    let best = maximizing ? -Infinity : Infinity;

    for (const move of moves) {
      const { board: nextBoard } = E.applyMove(board, move.r, move.c, move.seq);
      const value = minimax(nextBoard, E.otherColor(colorToMove), depth - 1, alpha, beta, forColor);

      if (maximizing) {
        if (value > best) best = value;
        if (best > alpha) alpha = best;
      } else {
        if (value < best) best = value;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
    }

    return best;
  }

  // Elige la mejor jugada para `color` en `board`. Devuelve
  // { r, c, seq } o null si no hay jugadas (partida terminada).
  function chooseMove(board, color, depth = 5) {
    const moves = flattenMoves(board, color);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    let bestMove = moves[0];
    let bestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const move of moves) {
      const { board: nextBoard } = E.applyMove(board, move.r, move.c, move.seq);
      const score = minimax(nextBoard, E.otherColor(color), depth - 1, alpha, beta, color);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (bestScore > alpha) alpha = bestScore;
    }

    return bestMove;
  }

  window.OzamaCheckersAI = { chooseMove, evaluate };
})();
