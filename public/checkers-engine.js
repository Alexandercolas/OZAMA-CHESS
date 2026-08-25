'use strict';

// ================================================================
// OZAMA CHESS - Motor de Damas (Checkers) Dominicano/Espanol
// ================================================================
// Reglas implementadas (estandar "Damas" como se juega en RD):
//   - Tablero 8x8, solo casillas oscuras. board[row][col], row 0 = arriba.
//   - 'w' inicia abajo (filas 5-7), 'b' inicia arriba (filas 0-2), 12 piezas c/u.
//   - Peones capturan en diagonal hacia adelante Y hacia atras.
//   - Captura obligatoria: si hay al menos una captura disponible, es
//     obligatorio capturar (no se puede mover de otra forma).
//   - Captura multiple: tras capturar, si hay otra captura disponible
//     desde la nueva posicion, es obligatorio continuar la cadena.
//   - Regla de mayoria: si hay varias secuencias de captura posibles,
//     solo son legales las que capturan el mayor numero de piezas.
//   - Coronacion: un peon que llega a la ultima fila del rival se
//     corona "dama" (rey).
//   - Damas vuelan: se mueven y capturan cualquier cantidad de casillas
//     en diagonal (como un alfil), siempre que el camino este libre y,
//     al capturar, haya como maximo una pieza enemiga en el camino con
//     casillas vacias despues de ella para aterrizar.
//   - Fin de juego: pierde quien no tiene piezas o no puede mover.
//
// No usa modulos ES (mismo patron que el resto de public/*.js): expone
// una API publica pequena en window.OzamaCheckers.

(function () {
  const SIZE = 8;
  const COLOR = { WHITE: 'w', BLACK: 'b' };

  function otherColor(color) {
    return color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
  }

  function inBounds(r, c) {
    return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  }

  function isDarkSquare(r, c) {
    return (r + c) % 2 === 1;
  }

  function createInitialBoard() {
    const board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!isDarkSquare(r, c)) continue;
        if (r <= 2) board[r][c] = { color: COLOR.BLACK, king: false };
        else if (r >= 5) board[r][c] = { color: COLOR.WHITE, king: false };
      }
    }
    return board;
  }

  function cloneBoard(board) {
    return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
  }

  const MAN_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // Todas las cadenas de captura posibles para la pieza en (r,c).
  // Devuelve una lista de secuencias; cada secuencia es un array de
  // pasos { toR, toC, capturedR, capturedC }, en orden.
  function findCaptureSequences(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const sequences = [];

    function walk(currentBoard, fromR, fromC, path) {
      const currentPiece = currentBoard[fromR][fromC];
      const dirs = MAN_DIRS;
      let extended = false;

      for (const [dr, dc] of dirs) {
        if (currentPiece.king) {
          // Dama: vuela buscando la primera pieza en el camino.
          let step = 1;
          let enemyR = -1, enemyC = -1;
          while (inBounds(fromR + dr * step, fromC + dc * step)) {
            const nr = fromR + dr * step;
            const nc = fromC + dc * step;
            const occupant = currentBoard[nr][nc];
            if (!occupant) {
              if (enemyR !== -1) {
                // Casilla vacia despues de la pieza enemiga: aterrizaje valido.
                const nextBoard = cloneBoard(currentBoard);
                nextBoard[enemyR][enemyC] = null;
                nextBoard[fromR][fromC] = null;
                nextBoard[nr][nc] = currentPiece;
                const nextPath = [...path, { toR: nr, toC: nc, capturedR: enemyR, capturedC: enemyC }];
                extended = true;
                walk(nextBoard, nr, nc, nextPath);
              }
              step++;
              continue;
            }
            if (occupant.color === currentPiece.color || enemyR !== -1) break;
            enemyR = nr; enemyC = nc;
            step++;
          }
        } else {
          const midR = fromR + dr;
          const midC = fromC + dc;
          const landR = fromR + dr * 2;
          const landC = fromC + dc * 2;
          if (!inBounds(landR, landC)) continue;
          const mid = currentBoard[midR][midC];
          if (!mid || mid.color === currentPiece.color) continue;
          if (currentBoard[landR][landC]) continue;

          const nextBoard = cloneBoard(currentBoard);
          nextBoard[midR][midC] = null;
          nextBoard[fromR][fromC] = null;
          const promotes = !currentPiece.king && (currentPiece.color === COLOR.WHITE ? landR === 0 : landR === SIZE - 1);
          nextBoard[landR][landC] = promotes ? { ...currentPiece, king: true } : currentPiece;
          const nextPath = [...path, { toR: landR, toC: landC, capturedR: midR, capturedC: midC }];
          extended = true;
          // Una vez coronada a mitad de cadena, se detiene la captura en
          // esa jugada (regla comun en damas espanolas/dominicanas).
          if (promotes) {
            sequences.push(nextPath);
          } else {
            walk(nextBoard, landR, landC, nextPath);
          }
        }
      }

      if (!extended && path.length > 0) sequences.push(path);
    }

    walk(board, r, c, []);
    return sequences;
  }

  // Movimientos simples (sin captura) de una pieza, solo validos cuando
  // no hay ninguna captura obligatoria disponible en todo el tablero.
  function findSimpleMoves(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const moves = [];

    if (piece.king) {
      for (const [dr, dc] of MAN_DIRS) {
        let step = 1;
        while (inBounds(r + dr * step, c + dc * step)) {
          const nr = r + dr * step, nc = c + dc * step;
          if (board[nr][nc]) break;
          moves.push({ toR: nr, toC: nc });
          step++;
        }
      }
      return moves;
    }

    const forwardDirs = piece.color === COLOR.WHITE ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    for (const [dr, dc] of forwardDirs) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc) && !board[nr][nc]) moves.push({ toR: nr, toC: nc });
    }
    return moves;
  }

  // Todas las piezas de `color` que tienen al menos una captura, junto
  // con la longitud maxima de captura encontrada en todo el tablero.
  function collectAllCaptures(board, color) {
    let maxLen = 0;
    const bySquare = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== color) continue;
        const seqs = findCaptureSequences(board, r, c);
        if (!seqs.length) continue;
        for (const seq of seqs) maxLen = Math.max(maxLen, seq.length);
        bySquare.push({ r, c, sequences: seqs });
      }
    }
    return { bySquare, maxLen };
  }

  // API principal: movimientos legales para una pieza, aplicando
  // captura obligatoria + regla de mayoria a nivel de todo el tablero.
  function getLegalMovesForSquare(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const { bySquare, maxLen } = collectAllCaptures(board, piece.color);

    if (maxLen > 0) {
      const entry = bySquare.find((e) => e.r === r && e.c === c);
      if (!entry) return [];
      return entry.sequences.filter((seq) => seq.length === maxLen);
    }

    return findSimpleMoves(board, r, c).map((m) => [{ toR: m.toR, toC: m.toC, capturedR: -1, capturedC: -1 }]);
  }

  // Todas las jugadas legales de `color`, agrupadas por casilla de origen.
  function getAllLegalMoves(board, color) {
    const { bySquare, maxLen } = collectAllCaptures(board, color);
    if (maxLen > 0) {
      return bySquare
        .map(({ r, c, sequences }) => ({ r, c, sequences: sequences.filter((s) => s.length === maxLen) }))
        .filter((e) => e.sequences.length > 0);
    }

    const result = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== color) continue;
        const moves = findSimpleMoves(board, r, c);
        if (moves.length) {
          result.push({ r, c, sequences: moves.map((m) => [{ toR: m.toR, toC: m.toC, capturedR: -1, capturedC: -1 }]) });
        }
      }
    }
    return result;
  }

  // Aplica una secuencia de pasos (una entrada de `sequences`) al tablero.
  // Devuelve { board, captured, promoted }.
  function applyMove(board, fromR, fromC, sequence) {
    const next = cloneBoard(board);
    const piece = next[fromR][fromC];
    if (!piece) throw new Error('No hay pieza en la casilla de origen.');
    next[fromR][fromC] = null;

    const captured = [];
    let cur = { r: fromR, c: fromC };
    let promoted = false;

    for (const step of sequence) {
      if (step.capturedR !== -1) {
        captured.push({ r: step.capturedR, c: step.capturedC });
        next[step.capturedR][step.capturedC] = null;
      }
      cur = { r: step.toR, c: step.toC };
    }

    const finalColor = piece.color;
    const reachedBackRank = finalColor === COLOR.WHITE ? cur.r === 0 : cur.r === SIZE - 1;
    const willBeKing = piece.king || reachedBackRank;
    if (!piece.king && willBeKing) promoted = true;
    next[cur.r][cur.c] = { color: finalColor, king: willBeKing };

    return { board: next, captured, promoted, to: cur };
  }

  function countPieces(board, color) {
    let count = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (board[r][c] && board[r][c].color === color) count++;
      }
    }
    return count;
  }

  // { over, winner, reason } -- reason: 'no-pieces' | 'no-moves' | null
  function checkGameOver(board, colorToMove) {
    if (countPieces(board, colorToMove) === 0) {
      return { over: true, winner: otherColor(colorToMove), reason: 'no-pieces' };
    }
    const moves = getAllLegalMoves(board, colorToMove);
    if (moves.length === 0) {
      return { over: true, winner: otherColor(colorToMove), reason: 'no-moves' };
    }
    return { over: false, winner: null, reason: null };
  }

  const OzamaCheckers = {
    SIZE,
    COLOR,
    createInitialBoard,
    cloneBoard,
    isDarkSquare,
    getLegalMovesForSquare,
    getAllLegalMoves,
    applyMove,
    checkGameOver,
    otherColor,
  };

  // Disponible en el navegador (window.OzamaCheckers) y en Node/servidor
  // (module.exports), para que el cliente y el servidor validen las
  // jugadas con exactamente el mismo codigo -- nunca confiar en un
  // motor de reglas distinto en cada lado.
  if (typeof window !== 'undefined') window.OzamaCheckers = OzamaCheckers;
  if (typeof module !== 'undefined' && module.exports) module.exports = OzamaCheckers;
})();
