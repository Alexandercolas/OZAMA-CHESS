'use strict';

// OZAMA CHESS - local bot engine.
// Uses the chess rules exposed by script.js: getLegalMovesForSquare and isInCheck.
const BOT = (() => {
  const TABLES = {
    p: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ],
    n: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50],
    ],
    b: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20],
    ],
    r: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0],
    ],
    q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20],
    ],
    k: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20],
    ],
  };

  const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const DEPTH = { easy: 1, medium: 2, hard: 3, master: 4 };

  function cloneBoard(board) {
    return board.map(row => row.map(piece => piece ? { ...piece } : null));
  }

  function posValue(type, row, col, isWhite) {
    const table = TABLES[type];
    if (!table) return 0;
    return table[isWhite ? row : 7 - row][col];
  }

  function evaluate(board, botColor) {
    let score = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const isWhite = piece.color === 'w';
        const value = (PIECE_VALUE[piece.type] || 0) + posValue(piece.type, r, c, isWhite);
        score += isWhite ? value : -value;
      }
    }
    return botColor === 'w' ? score : -score;
  }

  function getAllMoves(board, color, gameState) {
    const moves = [];
    if (typeof getLegalMovesForSquare !== 'function') return moves;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== color) continue;
        for (const to of getLegalMovesForSquare(board, r, c, gameState)) {
          moves.push({ from: { row: r, col: c }, to: { ...to } });
        }
      }
    }
    return moves;
  }

  function applyMove(board, from, to, gameState) {
    const newBoard = cloneBoard(board);
    const piece = newBoard[from.row][from.col];
    if (!piece) return newBoard;

    if (to.enPassant && gameState.enPassantTarget) {
      newBoard[from.row][gameState.enPassantTarget.col] = null;
    }

    newBoard[to.row][to.col] = piece;
    newBoard[from.row][from.col] = null;

    if (piece.type === 'k' && Math.abs(to.col - from.col) === 2) {
      if (to.col > from.col) {
        newBoard[to.row][5] = newBoard[to.row][7];
        newBoard[to.row][7] = null;
      } else {
        newBoard[to.row][3] = newBoard[to.row][0];
        newBoard[to.row][0] = null;
      }
    }

    if (piece.type === 'p' && (to.row === 0 || to.row === 7)) {
      newBoard[to.row][to.col] = { type: 'q', color: piece.color };
    }

    return newBoard;
  }

  function nextGameState(gameState, boardBefore, from, to, piece) {
    const rights = {
      w: { ...(gameState.castlingRights?.w || {}) },
      b: { ...(gameState.castlingRights?.b || {}) },
    };

    if (piece.type === 'k') {
      rights[piece.color].kingside = false;
      rights[piece.color].queenside = false;
    }
    if (piece.type === 'r') {
      if (from.col === 7) rights[piece.color].kingside = false;
      if (from.col === 0) rights[piece.color].queenside = false;
    }

    const capturedPiece = boardBefore[to.row][to.col];
    if (capturedPiece?.type === 'r') {
      if (to.col === 7) rights[capturedPiece.color].kingside = false;
      if (to.col === 0) rights[capturedPiece.color].queenside = false;
    }

    let enPassantTarget = null;
    if (piece.type === 'p' && Math.abs(to.row - from.row) === 2) {
      enPassantTarget = { row: (from.row + to.row) / 2, col: from.col };
    }

    const captured = !!capturedPiece || !!to.enPassant;
    return {
      ...gameState,
      board: null,
      castlingRights: rights,
      enPassantTarget,
      halfMoveClock: (piece.type === 'p' || captured) ? 0 : (gameState.halfMoveClock || 0) + 1,
    };
  }

  function orderMoves(moves, board) {
    return moves.sort((a, b) => {
      const capB = board[b.to.row][b.to.col];
      const capA = board[a.to.row][a.to.col];
      return (capB ? PIECE_VALUE[capB.type] || 0 : 0) - (capA ? PIECE_VALUE[capA.type] || 0 : 0);
    });
  }

  function minimax(board, depth, alpha, beta, maximizing, botColor, gameState) {
    if (depth <= 0) return evaluate(board, botColor);

    const color = maximizing ? botColor : (botColor === 'w' ? 'b' : 'w');
    const moves = orderMoves(getAllMoves(board, color, gameState), board);

    if (!moves.length) {
      if (typeof isInCheck === 'function' && isInCheck(board, color)) {
        return maximizing ? -99999 + depth : 99999 - depth;
      }
      return 0;
    }

    if (maximizing) {
      let best = -Infinity;
      for (const move of moves) {
        const piece = board[move.from.row][move.from.col];
        const nextBoard = applyMove(board, move.from, move.to, gameState);
        const nextState = nextGameState(gameState, board, move.from, move.to, piece);
        const score = minimax(nextBoard, depth - 1, alpha, beta, false, botColor, nextState);
        best = Math.max(best, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return best;
    }

    let best = Infinity;
    for (const move of moves) {
      const piece = board[move.from.row][move.from.col];
      const nextBoard = applyMove(board, move.from, move.to, gameState);
      const nextState = nextGameState(gameState, board, move.from, move.to, piece);
      const score = minimax(nextBoard, depth - 1, alpha, beta, true, botColor, nextState);
      best = Math.min(best, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return best;
  }

  function getBestMove(board, botColor, difficulty, gameState) {
    const moves = getAllMoves(board, botColor, gameState);
    if (!moves.length) return null;

    if (difficulty === 'easy') {
      const captures = moves.filter(move => board[move.to.row][move.to.col]);
      const pool = captures.length && Math.random() < 0.7 ? captures : moves;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const depth = DEPTH[difficulty] || DEPTH.medium;
    let bestMove = null;
    let bestScore = -Infinity;

    for (const move of orderMoves([...moves], board)) {
      const piece = board[move.from.row][move.from.col];
      const nextBoard = applyMove(board, move.from, move.to, gameState);
      const nextState = nextGameState(gameState, board, move.from, move.to, piece);
      const jitter = difficulty === 'medium' ? (Math.random() - 0.5) * 25 : 0;
      const score = minimax(nextBoard, depth - 1, -Infinity, Infinity, false, botColor, nextState) + jitter;
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
    return bestMove;
  }

  return {
    move(board, botColor, difficulty, gameState, callback) {
      const delay = difficulty === 'easy' ? 300 : difficulty === 'medium' ? 500 : 750;
      setTimeout(() => {
        try {
          callback(getBestMove(cloneBoard(board), botColor, difficulty, gameState));
        } catch (err) {
          console.error('[BOT] Error:', err);
          callback(null);
        }
      }, delay);
    },
  };
})();

if (typeof window !== 'undefined') {
  window.BOT = BOT;
}
