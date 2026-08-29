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
  const E = self.OzamaCheckers;
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
  //
  // Profundizacion iterativa con presupuesto de tiempo: en vez de
  // buscar directo a `depth` (que en Alcazar/nivel 10 podia tardar
  // hasta ~19s en posiciones abiertas), busca 1, 2, 3... plies,
  // reordenando las jugadas por el puntaje de la vuelta anterior
  // (mejora mucho la poda alfa-beta) y se detiene apenas se agota
  // `timeBudgetMs`, devolviendo la mejor jugada de la ultima
  // profundidad que alcanzo a terminar completa. Siempre corre al
  // menos profundidad 1, y si encuentra mate forzado corta antes.
  function chooseMove(board, color, depth = 5, timeBudgetMs = 2500) {
    const moves = flattenMoves(board, color);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];

    const startTime = Date.now();
    let bestMove = moves[0];
    let moveScores = new Map();

    for (let d = 1; d <= depth; d++) {
      if (d > 1 && Date.now() - startTime > timeBudgetMs) break;

      const orderedMoves = [...moves].sort(
        (a, b) => (moveScores.get(b) ?? 0) - (moveScores.get(a) ?? 0)
      );

      let bestScoreThisDepth = -Infinity;
      let bestMoveThisDepth = orderedMoves[0];
      let alpha = -Infinity;
      const beta = Infinity;
      const newScores = new Map();

      for (const move of orderedMoves) {
        const { board: nextBoard } = E.applyMove(board, move.r, move.c, move.seq);
        const score = minimax(nextBoard, E.otherColor(color), d - 1, alpha, beta, color);
        newScores.set(move, score);
        if (score > bestScoreThisDepth) {
          bestScoreThisDepth = score;
          bestMoveThisDepth = move;
        }
        if (bestScoreThisDepth > alpha) alpha = bestScoreThisDepth;
        // Salvavidas: si una sola profundidad se esta yendo muy larga
        // (posicion inusualmente abierta), no sigas evaluando el resto
        // de jugadas raiz -- ya hay una candidata decente.
        if (Date.now() - startTime > timeBudgetMs * 1.6) break;
      }

      moveScores = newScores;
      bestMove = bestMoveThisDepth;

      if (bestScoreThisDepth > 90000 || bestScoreThisDepth < -90000) break; // mate forzado encontrado
    }

    return bestMove;
  }

  const OzamaCheckersAI = { chooseMove, evaluate };
  if (typeof self !== 'undefined') self.OzamaCheckersAI = OzamaCheckersAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = OzamaCheckersAI;
})();
