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

  // Senal de "se acabo el tiempo" para cortar una busqueda a mitad de
  // camino -- una sola llamada de minimax en una posicion abierta
  // puede tardar varios segundos ella sola, asi que el limite de
  // tiempo tiene que vivir DENTRO de la recursion (chequear solo entre
  // jugadas raiz, como se hacia antes, no alcanzaba: eso solo corta
  // entre una jugada raiz y la siguiente, no en medio de una).
  const SEARCH_TIMEOUT = Symbol('search_timeout');

  function minimax(board, colorToMove, depth, alpha, beta, forColor, deadline) {
    if (deadline !== undefined && Date.now() > deadline) throw SEARCH_TIMEOUT;

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
      const value = minimax(nextBoard, E.otherColor(colorToMove), depth - 1, alpha, beta, forColor, deadline);

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

    const deadline = Date.now() + timeBudgetMs;
    let bestMove = moves[0];
    let moveScores = new Map();

    for (let d = 1; d <= depth; d++) {
      if (d > 1 && Date.now() > deadline) break;

      const orderedMoves = [...moves].sort(
        (a, b) => (moveScores.get(b) ?? 0) - (moveScores.get(a) ?? 0)
      );

      let bestScoreThisDepth = -Infinity;
      let bestMoveThisDepth = orderedMoves[0];
      let alpha = -Infinity;
      const beta = Infinity;
      const newScores = new Map();
      let timedOut = false;

      try {
        for (const move of orderedMoves) {
          const { board: nextBoard } = E.applyMove(board, move.r, move.c, move.seq);
          const score = minimax(nextBoard, E.otherColor(color), d - 1, alpha, beta, color, deadline);
          newScores.set(move, score);
          if (score > bestScoreThisDepth) {
            bestScoreThisDepth = score;
            bestMoveThisDepth = move;
          }
          if (bestScoreThisDepth > alpha) alpha = bestScoreThisDepth;
        }
      } catch (err) {
        if (err !== SEARCH_TIMEOUT) throw err;
        timedOut = true;
      }

      // Una profundidad que se corto a la mitad queda descartada
      // entera -- alfa-beta con una busqueda incompleta puede dar un
      // puntaje enganoso para las ultimas jugadas evaluadas. Se
      // devuelve la mejor jugada de la ultima profundidad que si
      // termino completa.
      if (timedOut) break;

      moveScores = newScores;
      bestMove = bestMoveThisDepth;

      if (bestScoreThisDepth > 90000 || bestScoreThisDepth < -90000) break; // mate forzado encontrado
    }

    return bestMove;
  }

  // Analisis post-partida (beneficio Premium, ver damas.html): para
  // una posicion y una jugada REALMENTE jugada, compara el puntaje de
  // esa jugada contra el de la mejor jugada disponible ahi -- mismo
  // patron que bot.js usa para ajedrez (BOT.analyzePosition), pero
  // reusando el motor de Damas que YA existe (minimax de arriba, el
  // mismo que juega el bot) en vez de inventar una evaluacion nueva.
  // La jugada jugada se identifica por casilla de origen + casilla
  // FINAL de aterrizaje (no hace falta la cadena de capturas exacta),
  // asi tambien funciona con el `lastMove` que ya manda el servidor
  // en partidas online.
  const ANALYSIS_DEPTH = 5;

  function analyzePosition(board, movingColor, fromR, fromC, toR, toC, depth = ANALYSIS_DEPTH) {
    const moves = flattenMoves(board, movingColor);
    if (!moves.length) return null;

    const scoreOf = (move) => {
      const { board: nextBoard } = E.applyMove(board, move.r, move.c, move.seq);
      return minimax(nextBoard, E.otherColor(movingColor), depth - 1, -Infinity, Infinity, movingColor, undefined);
    };

    let bestScore = -Infinity;
    for (const move of moves) {
      const score = scoreOf(move);
      if (score > bestScore) bestScore = score;
    }

    const playedMove = moves.find((m) => {
      if (m.r !== fromR || m.c !== fromC) return false;
      const last = m.seq[m.seq.length - 1];
      return last.toR === toR && last.toC === toC;
    });
    if (!playedMove) return null;
    const playedScore = scoreOf(playedMove);

    return { bestScore, playedScore, delta: Math.max(0, bestScore - playedScore) };
  }

  const OzamaCheckersAI = { chooseMove, evaluate, analyzePosition };
  if (typeof self !== 'undefined') self.OzamaCheckersAI = OzamaCheckersAI;
  if (typeof module !== 'undefined' && module.exports) module.exports = OzamaCheckersAI;
})();
