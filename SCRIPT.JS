'use strict';

// ================================================================
// SECTION 0: SOUND SYSTEM
// ================================================================
// ================================================================
// SECTION 0: SOUND SYSTEM — Web Audio API
// No requiere archivos .mp3 — funciona en Brave, Chrome, Firefox
// ================================================================

let _audioCtx = null;

/**
 * Obtiene o crea el AudioContext.
 * Se resume automáticamente si Brave lo suspendió.
 */
function getAudioCtx() {
  if (!_audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    _audioCtx = new AC();
  }
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  return _audioCtx;
}

// Desbloquear en el primer clic (requerido por Brave y Chrome)
document.addEventListener('click', () => getAudioCtx(), { once: true });

/**
 * Reproduce un sonido generado por síntesis.
 * @param {string} name — move | capture | check | castle | gameover
 */
function playSound(name) {
  try {
    const ctx = getAudioCtx();
    switch (name) {
      case 'move':     _soundMove(ctx);     break;
      case 'capture':  _soundCapture(ctx);  break;
      case 'check':    _soundCheck(ctx);    break;
      case 'castle':   _soundCastle(ctx);   break;
      case 'gameover': _soundGameover(ctx); break;
    }
  } catch (e) {
    // Ignorar errores silenciosamente
  }
}

// ── Generadores de sonido ────────────────────────────────────────

/** Click suave — movimiento normal */
function _soundMove(ctx) {
  _tone(ctx, { type: 'sine', freq: 750, endFreq: 420,
               vol: 0.28, duration: 0.1 });
}

/** Golpe más fuerte — captura */
function _soundCapture(ctx) {
  _tone(ctx, { type: 'sawtooth', freq: 320, endFreq: 90,
               vol: 0.38, duration: 0.18 });
  _tone(ctx, { type: 'sine',     freq: 180, endFreq: 80,
               vol: 0.2,  duration: 0.22, delay: 0.02 });
}

/** Dos pitidos alerta — jaque */
function _soundCheck(ctx) {
  _tone(ctx, { type: 'square', freq: 620, endFreq: 620,
               vol: 0.22, duration: 0.11 });
  _tone(ctx, { type: 'square', freq: 840, endFreq: 840,
               vol: 0.22, duration: 0.11, delay: 0.14 });
}

/** Doble click — enroque */
function _soundCastle(ctx) {
  _tone(ctx, { type: 'sine', freq: 680, endFreq: 380,
               vol: 0.28, duration: 0.09 });
  _tone(ctx, { type: 'sine', freq: 580, endFreq: 320,
               vol: 0.28, duration: 0.09, delay: 0.13 });
}

/** Acorde dramático descendente — fin de partida */
function _soundGameover(ctx) {
  const chord = [
    { freq: 520, delay: 0.0  },
    { freq: 414, delay: 0.18 },
    { freq: 310, delay: 0.36 },
    { freq: 260, delay: 0.54 },
  ];
  chord.forEach(({ freq, delay }) => {
    _tone(ctx, { type: 'sine', freq, endFreq: freq * 0.7,
                 vol: 0.18, duration: 0.7, delay });
  });
}

/**
 * Función base: crea un oscilador con envelope de volumen.
 * @param {object} opts
 */
function _tone(ctx, { type, freq, endFreq, vol, duration, delay = 0 }) {
  const t   = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();

  osc.connect(env);
  env.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== freq) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  }

  env.gain.setValueAtTime(vol, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.start(t);
  osc.stop(t + duration + 0.01);
}

// ================================================================
// SECTION 1: CONFIG & CONSTANTS
// ================================================================

const CONFIG = {
  BOARD_SIZE:     8,
  PIECE_PATH:     './assets/pieces/',
  USE_INLINE_SVG: true,
  BOARD_FLIPPED:  false,
};

const PIECE = {
  PAWN:   'p',
  KNIGHT: 'n',
  BISHOP: 'b',
  ROOK:   'r',
  QUEEN:  'q',
  KING:   'k',
};

const COLOR = {
  WHITE: 'w',
  BLACK: 'b',
};

const STATUS = {
  PLAYING:   'playing',
  CHECK:     'check',
  CHECKMATE: 'checkmate',
  STALEMATE: 'stalemate',
  DRAW:      'draw',
};

// ================================================================
// SECTION 2: SVG PIECE ASSETS
// ================================================================

const PIECE_SVGS = {

  wp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <circle cx="22.5" cy="10" r="6.5" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M17 34 Q16 24 22.5 21 Q29 24 28 34 Z" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="10" y="34" width="25" height="4.5" rx="2.2" fill="url(#wg)" stroke="#7A5800" stroke-width="1.2"/>
  </svg>`,

  wn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <path d="M22 38 H9 L11 29 Q8 24 10 18 Q12 12 18 9 Q20 7 23 8 Q28 7 30 11 Q32 14 30 18 L34 22 Q33 26 28 28 L27 38 Z"
      fill="url(#wg2)" stroke="#7A5800" stroke-width="1.3"/>
    <circle cx="19" cy="13" r="2" fill="#7A5800"/>
    <path d="M18 9 Q16 6 13 7 Q11 10 14 13" fill="url(#wg2)" stroke="#7A5800" stroke-width="1"/>
  </svg>`,

  wb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg3" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <circle cx="22.5" cy="8" r="3.5" fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M22.5 11 Q27 15 28 21 Q29 28 26 32 L19 32 Q16 28 17 21 Q18 15 22.5 11 Z"
      fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M16 32 Q14 33 14 34 L31 34 Q31 33 29 32 Z" fill="url(#wg3)" stroke="#7A5800" stroke-width="1"/>
    <rect x="9" y="34" width="27" height="4" rx="2" fill="url(#wg3)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M18 22 Q22.5 20 27 22" fill="none" stroke="#7A5800" stroke-width="1" opacity="0.6"/>
  </svg>`,

  wr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg4" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <rect x="9"  y="7" width="6"  height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="20" y="7" width="5"  height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="30" y="7" width="6"  height="9" rx="1" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M9 16 L12 16 L12 32 L33 32 L33 16 L36 16 L36 14 L9 14 Z"
      fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="8" y="32" width="29" height="4.5" rx="2" fill="url(#wg4)" stroke="#7A5800" stroke-width="1.2"/>
  </svg>`,

  wq: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg5" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <circle cx="8"    cy="11" r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/>
    <circle cx="22.5" cy="7"  r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/>
    <circle cx="37"   cy="11" r="3.5" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/>
    <circle cx="14"   cy="9"  r="2.8" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.1"/>
    <circle cx="31"   cy="9"  r="2.8" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.1"/>
    <path d="M8 13 L10 31 Q16 28 22.5 30 Q29 28 35 31 L37 13 L31 20 L22.5 11 L14 20 Z"
      fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M10 31 Q16 34 22.5 33 Q29 34 35 31 L35 34 Q29 37 22.5 36 Q16 37 10 34 Z"
      fill="url(#wg5)" stroke="#7A5800" stroke-width="1"/>
    <rect x="8" y="34" width="29" height="4.5" rx="2" fill="url(#wg5)" stroke="#7A5800" stroke-width="1.2"/>
  </svg>`,

  wk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <defs><linearGradient id="wg6" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFE566"/><stop offset="100%" stop-color="#B8860B"/>
    </linearGradient></defs>
    <rect x="20" y="4"  width="5"  height="13" rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="15" y="7"  width="15" height="5"  rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M11 31 Q10 23 14 19 Q18 16 22.5 16 Q27 16 31 19 Q35 23 34 31 Z"
      fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/>
    <rect x="9" y="31" width="27" height="4.5" rx="2" fill="url(#wg6)" stroke="#7A5800" stroke-width="1.2"/>
    <path d="M16 23 Q22.5 21 29 23" fill="none" stroke="#7A5800" stroke-width="1" opacity="0.5"/>
  </svg>`,

  bp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <circle cx="22.5" cy="10" r="6.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M17 34 Q16 24 22.5 21 Q29 24 28 34 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="10" y="34" width="25" height="4.5" rx="2.2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
  </svg>`,

  bn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <path d="M22 38 H9 L11 29 Q8 24 10 18 Q12 12 18 9 Q20 7 23 8 Q28 7 30 11 Q32 14 30 18 L34 22 Q33 26 28 28 L27 38 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <circle cx="19" cy="13" r="2" fill="#D4AF37"/>
    <path d="M18 9 Q16 6 13 7 Q11 10 14 13" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1"/>
  </svg>`,

  bb: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <circle cx="22.5" cy="8" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M22.5 11 Q27 15 28 21 Q29 28 26 32 L19 32 Q16 28 17 21 Q18 15 22.5 11 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M16 32 Q14 33 14 34 L31 34 Q31 33 29 32 Z" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1"/>
    <rect x="9" y="34" width="27" height="4" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M18 22 Q22.5 20 27 22" fill="none" stroke="#D4AF37" stroke-width="1" opacity="0.7"/>
  </svg>`,

  br: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <rect x="9"  y="7" width="6"  height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="20" y="7" width="5"  height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="30" y="7" width="6"  height="9" rx="1" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M9 16 L12 16 L12 32 L33 32 L33 16 L36 16 L36 14 L9 14 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="8" y="32" width="29" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
  </svg>`,

  bq: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <circle cx="8"    cy="11" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <circle cx="22.5" cy="7"  r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <circle cx="37"   cy="11" r="3.5" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <circle cx="14"   cy="9"  r="2.8" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/>
    <circle cx="31"   cy="9"  r="2.8" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/>
    <path d="M8 13 L10 31 Q16 28 22.5 30 Q29 28 35 31 L37 13 L31 20 L22.5 11 L14 20 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M10 31 Q16 34 22.5 33 Q29 34 35 31 L35 34 Q29 37 22.5 36 Q16 37 10 34 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.2"/>
    <rect x="8" y="34" width="29" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
  </svg>`,

  bk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">
    <rect x="20" y="4"  width="5"  height="13" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="15" y="7"  width="15" height="5"  rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M11 31 Q10 23 14 19 Q18 16 22.5 16 Q27 16 31 19 Q35 23 34 31 Z"
      fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <rect x="9" y="31" width="27" height="4.5" rx="2" fill="#1A1A2E" stroke="#D4AF37" stroke-width="1.4"/>
    <path d="M16 23 Q22.5 21 29 23" fill="none" stroke="#D4AF37" stroke-width="1" opacity="0.6"/>
  </svg>`,
};

// ================================================================
// SECTION 3: GAME STATE
// ================================================================

let state = {
  board:    [],
  turn:     COLOR.WHITE,
  selected: null,
  legalMoves: [],
  castlingRights: {
    w: { kingside: true, queenside: true },
    b: { kingside: true, queenside: true },
  },
  enPassantTarget:      null,
  status:               STATUS.PLAYING,
  winner:               null,
  moveCount:            0,
  halfMoveClock:        0,
  moveHistory:          [],
  promotionPending:     null,
  _pendingHistoryEntry: null,
  lastMove:             null,
};

// ================================================================
// SECTION 4: BOARD INITIALIZATION
// ================================================================

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank = [PIECE.ROOK, PIECE.KNIGHT, PIECE.BISHOP, PIECE.QUEEN,
                    PIECE.KING, PIECE.BISHOP, PIECE.KNIGHT, PIECE.ROOK];
  backRank.forEach((type, col) => {
    board[0][col] = { type, color: COLOR.BLACK };
    board[7][col] = { type, color: COLOR.WHITE };
  });
  for (let col = 0; col < 8; col++) {
    board[1][col] = { type: PIECE.PAWN, color: COLOR.BLACK };
    board[6][col] = { type: PIECE.PAWN, color: COLOR.WHITE };
  }
  return board;
}

function startNewGame() {
  state.board                = createInitialBoard();
  state.turn                 = COLOR.WHITE;
  state.selected             = null;
  state.legalMoves           = [];
  state.castlingRights       = { w: { kingside: true, queenside: true },
                                  b: { kingside: true, queenside: true } };
  state.enPassantTarget      = null;
  state.status               = STATUS.PLAYING;
  state.winner               = null;
  state.moveCount            = 0;
  state.halfMoveClock        = 0;
  state.moveHistory          = [];
  state.promotionPending     = null;
  state._pendingHistoryEntry = null;
  state.lastMove             = null;
  renderBoard();
  updateStatusDisplay();
}

// ================================================================
// SECTION 5: UTILITY HELPERS
// ================================================================

function inBounds(row, col)  { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function enemy(color)        { return color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE; }
function cloneBoard(board)   { return board.map(row => row.map(cell => cell ? { ...cell } : null)); }

function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.type === PIECE.KING && board[r][c]?.color === color)
        return { row: r, col: c };
  return null;
}

function toAlgebraic(row, col) {
  return 'abcdefgh'[col] + String(8 - row);
}

/** Generates Standard Algebraic Notation for a completed move. */
function getMoveNotation(entry) {
  const { from, to, piece, captured, castling, enPassant,
          promotion, check, checkmate, boardBefore, epTargetBefore } = entry;
  const SYM    = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
  const suffix = checkmate ? '#' : check ? '+' : '';
  const isCap  = !!(captured || enPassant);

  if (castling === 'kingside')  return 'O-O'   + suffix;
  if (castling === 'queenside') return 'O-O-O' + suffix;

  const dest = toAlgebraic(to.row, to.col);
  const capX = isCap ? 'x' : '';

  if (piece.type === PIECE.PAWN) {
    let n = isCap ? 'abcdefgh'[from.col] + 'x' + dest : dest;
    if (promotion) n += '=' + SYM[promotion].toUpperCase();
    return n + suffix;
  }

  // Disambiguation for non-pawn pieces
  let disambig = '';
  if (boardBefore) {
    const tempRef = {
      castlingRights:  { w: { kingside: false, queenside: false },
                         b: { kingside: false, queenside: false } },
      enPassantTarget: epTargetBefore || null,
    };
    const ambiguous = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (r === from.row && c === from.col) continue;
        const p = boardBefore[r][c];
        if (p?.type === piece.type && p?.color === piece.color) {
          const lm = getLegalMovesForSquare(boardBefore, r, c, tempRef);
          if (lm.some(m => m.row === to.row && m.col === to.col))
            ambiguous.push({ row: r, col: c });
        }
      }
    }
    if (ambiguous.length > 0) {
      const sf = ambiguous.some(p => p.col === from.col);
      const sr = ambiguous.some(p => p.row === from.row);
      if      (!sf) disambig = 'abcdefgh'[from.col];
      else if (!sr) disambig = String(8 - from.row);
      else          disambig = toAlgebraic(from.row, from.col);
    }
  }
  return SYM[piece.type] + disambig + capX + dest + suffix;
}

// ================================================================
// SECTION 6: MOVE GENERATION (Pseudo-Legal)
// ================================================================

function getPseudoLegalMoves(board, row, col, gameStateRef) {
  const piece = board[row][col];
  if (!piece) return [];
  switch (piece.type) {
    case PIECE.PAWN:   return getPawnMoves(board, row, col, piece.color, gameStateRef);
    case PIECE.KNIGHT: return getKnightMoves(board, row, col, piece.color);
    case PIECE.BISHOP: return getSlidingMoves(board, row, col, piece.color, [[-1,-1],[-1,1],[1,-1],[1,1]]);
    case PIECE.ROOK:   return getSlidingMoves(board, row, col, piece.color, [[-1,0],[1,0],[0,-1],[0,1]]);
    case PIECE.QUEEN:  return getSlidingMoves(board, row, col, piece.color,
                         [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    case PIECE.KING:   return getKingMoves(board, row, col, piece.color, gameStateRef);
    default: return [];
  }
}

function getPawnMoves(board, row, col, color, gameStateRef) {
  const moves    = [];
  const dir      = color === COLOR.WHITE ? -1 : 1;
  const startRow = color === COLOR.WHITE ? 6 : 1;
  const r1       = row + dir;

  if (inBounds(r1, col) && !board[r1][col]) {
    moves.push({ row: r1, col });
    const r2 = row + dir * 2;
    if (row === startRow && !board[r2][col]) moves.push({ row: r2, col });
  }
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (inBounds(r1, c) && board[r1][c]?.color !== color && board[r1][c])
      moves.push({ row: r1, col: c });
  }
  if (gameStateRef?.enPassantTarget) {
    const ep = gameStateRef.enPassantTarget;
    if (ep.row === r1 && Math.abs(ep.col - col) === 1)
      moves.push({ row: r1, col: ep.col, enPassant: true });
  }
  return moves;
}

function getKnightMoves(board, row, col, color) {
  return [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
    .map(([dr, dc]) => ({ row: row+dr, col: col+dc }))
    .filter(({ row: r, col: c }) => inBounds(r, c) && board[r][c]?.color !== color);
}

function getSlidingMoves(board, row, col, color, directions) {
  const moves = [];
  for (const [dr, dc] of directions) {
    let r = row+dr, c = col+dc;
    while (inBounds(r, c)) {
      if (board[r][c]) { if (board[r][c].color !== color) moves.push({ row: r, col: c }); break; }
      moves.push({ row: r, col: c });
      r += dr; c += dc;
    }
  }
  return moves;
}

function getKingMoves(board, row, col, color, gameStateRef) {
  const moves = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]
    .map(([dr, dc]) => ({ row: row+dr, col: col+dc }))
    .filter(({ row: r, col: c }) => inBounds(r, c) && board[r][c]?.color !== color);
  if (gameStateRef) moves.push(...getCastlingMoves(board, row, col, color, gameStateRef));
  return moves;
}

// ================================================================
// SECTION 7: ATTACK DETECTION & CHECK
// ================================================================

function isSquareAttacked(board, row, col, byColor) {
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const r = row+dr, c = col+dc;
    if (inBounds(r,c) && board[r][c]?.color === byColor && board[r][c]?.type === PIECE.KNIGHT) return true;
  }
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let r = row+dr, c = col+dc;
    while (inBounds(r,c)) {
      if (board[r][c]) { if (board[r][c].color===byColor && (board[r][c].type===PIECE.BISHOP||board[r][c].type===PIECE.QUEEN)) return true; break; }
      r+=dr; c+=dc;
    }
  }
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let r = row+dr, c = col+dc;
    while (inBounds(r,c)) {
      if (board[r][c]) { if (board[r][c].color===byColor && (board[r][c].type===PIECE.ROOK||board[r][c].type===PIECE.QUEEN)) return true; break; }
      r+=dr; c+=dc;
    }
  }
  const pr = row + (byColor === COLOR.WHITE ? 1 : -1);
  for (const dc of [-1,1])
    if (inBounds(pr, col+dc) && board[pr][col+dc]?.color===byColor && board[pr][col+dc]?.type===PIECE.PAWN) return true;
  for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const r=row+dr, c=col+dc;
    if (inBounds(r,c) && board[r][c]?.color===byColor && board[r][c]?.type===PIECE.KING) return true;
  }
  return false;
}

function isInCheck(board, color) {
  const king = findKing(board, color);
  return king ? isSquareAttacked(board, king.row, king.col, enemy(color)) : false;
}

function wouldLeaveKingInCheck(board, from, to, color, gameStateRef) {
  const tb = cloneBoard(board);
  if (to.enPassant && gameStateRef?.enPassantTarget)
    tb[from.row][gameStateRef.enPassantTarget.col] = null;
  tb[to.row][to.col]     = tb[from.row][from.col];
  tb[from.row][from.col] = null;
  if (tb[to.row][to.col]?.type === PIECE.KING && Math.abs(to.col - from.col) === 2) {
    if (to.col > from.col) { tb[to.row][5] = tb[to.row][7]; tb[to.row][7] = null; }
    else                   { tb[to.row][3] = tb[to.row][0]; tb[to.row][0] = null; }
  }
  return isInCheck(tb, color);
}

function getLegalMovesForSquare(board, row, col, gameStateRef) {
  const piece = board[row][col];
  if (!piece) return [];
  return getPseudoLegalMoves(board, row, col, gameStateRef)
    .filter(to => !wouldLeaveKingInCheck(board, { row, col }, to, piece.color, gameStateRef));
}

// ================================================================
// SECTION 8: GAME STATUS
// ================================================================

function hasAnyLegalMove(board, color, gameStateRef) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]?.color === color && getLegalMovesForSquare(board, r, c, gameStateRef).length > 0)
        return true;
  return false;
}

function evaluateGameStatus(board, color, gameStateRef) {
  const inCheck = isInCheck(board, color);
  const canMove = hasAnyLegalMove(board, color, gameStateRef);
  if (inCheck  && !canMove) return STATUS.CHECKMATE;
  if (!inCheck && !canMove) return STATUS.STALEMATE;
  if ((gameStateRef?.halfMoveClock ?? 0) >= 100) return STATUS.DRAW;
  if (inCheck) return STATUS.CHECK;
  return STATUS.PLAYING;
}

// ================================================================
// SECTION 9: SPECIAL MOVES
// ================================================================

function getCastlingMoves(board, row, col, color, gameStateRef) {
  const moves  = [];
  const rights = gameStateRef.castlingRights[color];
  if (!rights || isInCheck(board, color)) return moves;

  if (rights.kingside) {
    const rk = board[row][7];
    if (rk?.type===PIECE.ROOK && rk?.color===color && !board[row][5] && !board[row][6] &&
        !isSquareAttacked(board,row,5,enemy(color)) && !isSquareAttacked(board,row,6,enemy(color)))
      moves.push({ row, col: 6, castling: 'kingside' });
  }
  if (rights.queenside) {
    const rq = board[row][0];
    if (rq?.type===PIECE.ROOK && rq?.color===color && !board[row][1] && !board[row][2] && !board[row][3] &&
        !isSquareAttacked(board,row,3,enemy(color)) && !isSquareAttacked(board,row,2,enemy(color)))
      moves.push({ row, col: 2, castling: 'queenside' });
  }
  return moves;
}

function checkPawnPromotion(board, row, col, color) {
  const backRank = color === COLOR.WHITE ? 0 : 7;
  if (board[row][col]?.type === PIECE.PAWN && row === backRank) {
    showPromotionDialog(row, col, color);
    return true;
  }
  return false;
}

/** FIX: Turn switch was missing — promoting player could move twice. */
function applyPromotion(row, col, color, chosenType) {
  if (!state.promotionPending) return;
  state.board[row][col] = { type: chosenType, color };
  state.promotionPending = null;
  hidePromotionDialog();

  if (state._pendingHistoryEntry) state._pendingHistoryEntry.promotion = chosenType;

  // CRITICAL: switch turn before evaluating
  state.turn = enemy(color);

  const newStatus = evaluateGameStatus(state.board, state.turn, state);
  state.status    = newStatus;
  if (newStatus === STATUS.CHECKMATE) state.winner = color;

  if (state._pendingHistoryEntry) {
    state._pendingHistoryEntry.check     = (newStatus === STATUS.CHECK || newStatus === STATUS.CHECKMATE);
    state._pendingHistoryEntry.checkmate = (newStatus === STATUS.CHECKMATE);
    state._pendingHistoryEntry.notation  = getMoveNotation(state._pendingHistoryEntry);
    state.moveHistory.push(state._pendingHistoryEntry);
    state._pendingHistoryEntry = null;
  }

  if (newStatus === STATUS.CHECKMATE || newStatus === STATUS.STALEMATE || newStatus === STATUS.DRAW) {
    setTimeout(() => playSound('gameover'), 60);
  } else if (newStatus === STATUS.CHECK) {
    playSound('move');
    setTimeout(() => playSound('check'), 60);
  } else {
    playSound('move');
  }

  renderBoard();
  updateStatusDisplay();

  if (newStatus === STATUS.CHECKMATE || newStatus === STATUS.STALEMATE || newStatus === STATUS.DRAW)
    setTimeout(() => showGameOver(newStatus, state.winner), 350);
}

// ================================================================
// SECTION 10: MOVE EXECUTION
// ================================================================

function executeMove(from, to) {
  const piece = state.board[from.row][from.col];
  if (!piece) return;

  const boardBefore    = cloneBoard(state.board);
  const epTargetBefore = state.enPassantTarget ? { ...state.enPassantTarget } : null;
  const capturedPiece  = state.board[to.row][to.col] ? { ...state.board[to.row][to.col] } : null;
  const isCastling     = !!to.castling;
  const isEnPassant    = !!to.enPassant;
  const isCapture      = !!(capturedPiece || isEnPassant);

  // En passant: remove captured pawn
  let enPassantCaptured = null;
  if (isEnPassant && state.enPassantTarget) {
    enPassantCaptured = { ...state.board[from.row][state.enPassantTarget.col] };
    state.board[from.row][state.enPassantTarget.col] = null;
  }

  state.board[to.row][to.col]    = { ...piece };
  state.board[from.row][from.col] = null;

  // Castling: move the rook
  if (isCastling) {
    if (to.castling === 'kingside') {
      state.board[to.row][5] = state.board[to.row][7]; state.board[to.row][7] = null;
    } else {
      state.board[to.row][3] = state.board[to.row][0]; state.board[to.row][0] = null;
    }
  }

  // Update castling rights
  if (piece.type === PIECE.KING) {
    state.castlingRights[piece.color].kingside  = false;
    state.castlingRights[piece.color].queenside = false;
  }
  if (piece.type === PIECE.ROOK) {
    if (from.col === 7) state.castlingRights[piece.color].kingside  = false;
    if (from.col === 0) state.castlingRights[piece.color].queenside = false;
  }
  // Rook captured: revoke enemy's right
  if (capturedPiece?.type === PIECE.ROOK) {
    if (to.col === 7) state.castlingRights[capturedPiece.color].kingside  = false;
    if (to.col === 0) state.castlingRights[capturedPiece.color].queenside = false;
  }

  // En passant target
  state.enPassantTarget = null;
  if (piece.type === PIECE.PAWN && Math.abs(to.row - from.row) === 2)
    state.enPassantTarget = { row: (from.row + to.row) / 2, col: from.col };

  // Half-move clock (50-move rule)
  state.halfMoveClock = (piece.type === PIECE.PAWN || isCapture) ? 0 : state.halfMoveClock + 1;

  // Last move for highlight
  state.lastMove = { from: { ...from }, to: { ...to } };

  // Build history entry
  const historyEntry = {
    from, to,
    piece:          { ...piece },
    captured:       capturedPiece || enPassantCaptured,
    castling:       to.castling  || null,
    enPassant:      isEnPassant,
    promotion:      null,
    check:          false,
    checkmate:      false,
    notation:       '',
    moveCount:      state.moveCount,
    boardBefore,
    epTargetBefore,
  };
  state.moveCount++;

  // Pawn promotion — pause here
  if (checkPawnPromotion(state.board, to.row, to.col, piece.color)) {
    state.promotionPending       = { row: to.row, col: to.col, color: piece.color };
    state._pendingHistoryEntry   = historyEntry;
    renderBoard();
    return;
  }

  state.turn = enemy(piece.color);

  const newStatus = evaluateGameStatus(state.board, state.turn, state);
  state.status    = newStatus;
  if (newStatus === STATUS.CHECKMATE) state.winner = piece.color;

  historyEntry.check     = (newStatus === STATUS.CHECK || newStatus === STATUS.CHECKMATE);
  historyEntry.checkmate = (newStatus === STATUS.CHECKMATE);
  historyEntry.notation  = getMoveNotation(historyEntry);
  state.moveHistory.push(historyEntry);

  // ── Sounds ─────────────────────────────────────────────────────
  if (newStatus === STATUS.CHECKMATE || newStatus === STATUS.STALEMATE || newStatus === STATUS.DRAW) {
    setTimeout(() => playSound('gameover'), 60);
  } else if (newStatus === STATUS.CHECK) {
    if (isCastling)       playSound('castle');
    else if (isCapture)   playSound('capture');
    else                  playSound('move');
    setTimeout(() => playSound('check'), 80);
  } else if (isCastling) {
    playSound('castle');
  } else if (isCapture) {
    playSound('capture');
  } else {
    playSound('move');
  }

  state.selected   = null;
  state.legalMoves = [];

  renderBoard();
  updateStatusDisplay();

  if (newStatus === STATUS.CHECKMATE || newStatus === STATUS.STALEMATE || newStatus === STATUS.DRAW)
    setTimeout(() => showGameOver(newStatus, state.winner), 350);
}

// ================================================================
// SECTION 11: EVENT HANDLING
// ================================================================

function handleSquareClick(row, col) {
  if (state.promotionPending)             return;
  if (state.status === STATUS.CHECKMATE)  return;
  if (state.status === STATUS.STALEMATE)  return;
  if (state.status === STATUS.DRAW)       return;

  const clicked = state.board[row][col];

  if (!state.selected) {
    if (!clicked || clicked.color !== state.turn) return;
    const moves = getLegalMovesForSquare(state.board, row, col, state);
    if (!moves.length) return;
    state.selected = { row, col }; state.legalMoves = moves;
    renderBoard(); return;
  }

  if (state.selected.row === row && state.selected.col === col) {
    state.selected = null; state.legalMoves = [];
    renderBoard(); return;
  }

  const targetMove = state.legalMoves.find(m => m.row === row && m.col === col);
  if (targetMove) { executeMove(state.selected, targetMove); return; }

  if (clicked?.color === state.turn) {
    state.selected = { row, col };
    state.legalMoves = getLegalMovesForSquare(state.board, row, col, state);
    renderBoard(); return;
  }

  state.selected = null; state.legalMoves = [];
  renderBoard();
}

// ================================================================
// SECTION 12: RENDERING
// ================================================================

function renderBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;
  boardEl.innerHTML = '';

  const kingInCheck = (state.status === STATUS.CHECK || state.status === STATUS.CHECKMATE)
    ? findKing(state.board, state.turn) : null;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square  = document.createElement('div');
      const isLight = (r + c) % 2 === 0;
      square.className   = `square ${isLight ? 'light' : 'dark'}`;
      square.dataset.row = r;
      square.dataset.col = c;

      if (state.lastMove) {
        if (r === state.lastMove.from.row && c === state.lastMove.from.col)
          square.classList.add('last-move-from');
        if (r === state.lastMove.to.row   && c === state.lastMove.to.col)
          square.classList.add('last-move-to');
      }
      if (state.selected?.row === r && state.selected?.col === c)
        square.classList.add('selected');
      if (kingInCheck?.row === r && kingInCheck?.col === c)
        square.classList.add('in-check');

      if (state.legalMoves.some(m => m.row === r && m.col === c)) {
        const ind     = document.createElement('div');
        ind.className = state.board[r][c] ? 'legal-capture' : 'legal-dot';
        square.appendChild(ind);
      }

      const piece = state.board[r][c];
      if (piece) {
        const pd     = document.createElement('div');
        pd.className = 'piece';
        pd.innerHTML = getPieceSVG(piece);
        square.appendChild(pd);
      }

      if (c === 0) {
        const rl = document.createElement('span');
        rl.className = 'rank-label'; rl.textContent = 8 - r;
        square.appendChild(rl);
      }
      if (r === 7) {
        const fl = document.createElement('span');
        fl.className = 'file-label'; fl.textContent = 'abcdefgh'[c];
        square.appendChild(fl);
      }

      square.addEventListener('click', () => handleSquareClick(r, c));
      boardEl.appendChild(square);
    }
  }
}

function getPieceSVG(piece) {
  const key = piece.color + piece.type;
  if (CONFIG.USE_INLINE_SVG) return PIECE_SVGS[key] || '';
  return `<img src="${CONFIG.PIECE_PATH}${key}.svg" alt="${key}" draggable="false"/>`;
}

// ================================================================
// SECTION 13: STATUS DISPLAY & UI
// ================================================================

function updateStatusDisplay() {
  const el = document.getElementById('status-message');
  if (!el) return;

  const turnName   = state.turn  === COLOR.WHITE ? 'White' : 'Black';
  const winnerName = state.winner === COLOR.WHITE ? 'White' : 'Black';

  const messages = {
    [STATUS.PLAYING]:   `${turnName}'s turn`,
    [STATUS.CHECK]:     `⚠️ ${turnName} is in CHECK!`,
    [STATUS.CHECKMATE]: `♚ CHECKMATE — ${winnerName} wins!`,
    [STATUS.STALEMATE]: `🤝 STALEMATE — It's a draw!`,
    [STATUS.DRAW]:      `🤝 DRAW — 50-move rule.`,
  };
  el.textContent = messages[state.status] || '';

  // FIX: active during CHECK too, not just PLAYING
  const active = state.status === STATUS.PLAYING || state.status === STATUS.CHECK;
  const wi = document.getElementById('white-turn');
  const bi = document.getElementById('black-turn');
  if (wi) wi.classList.toggle('active', state.turn === COLOR.WHITE && active);
  if (bi) bi.classList.toggle('active', state.turn === COLOR.BLACK && active);
}

function showGameOver(status, winner) {
  const overlay = document.getElementById('game-over-overlay');
  if (!overlay) return;
  const titleEl = overlay.querySelector('#game-over-title');
  const subEl   = overlay.querySelector('#game-over-subtitle');
  if (status === STATUS.CHECKMATE) {
    const w = winner === COLOR.WHITE ? 'White' : 'Black';
    if (titleEl) titleEl.textContent = 'CHECKMATE';
    if (subEl)   subEl.textContent   = `${w} wins the game!`;
  } else if (status === STATUS.STALEMATE) {
    if (titleEl) titleEl.textContent = 'STALEMATE';
    if (subEl)   subEl.textContent   = 'The game is a draw.';
  } else if (status === STATUS.DRAW) {
    if (titleEl) titleEl.textContent = 'DRAW';
    if (subEl)   subEl.textContent   = '50-move rule — no progress was made.';
  }
  overlay.classList.remove('hidden');
}

function hideGameOver() {
  document.getElementById('game-over-overlay')?.classList.add('hidden');
}

function showPromotionDialog(row, col, color) {
  const dialog = document.getElementById('promotion-dialog');
  if (!dialog) { applyPromotion(row, col, color, PIECE.QUEEN); return; }
  const container = dialog.querySelector('.promotion-options');
  if (container) {
    container.innerHTML = '';
    [PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT].forEach(type => {
      const btn = document.createElement('button');
      btn.className = 'promotion-btn';
      btn.innerHTML = getPieceSVG({ type, color });
      btn.title     = type.toUpperCase();
      btn.setAttribute('aria-label', `Promote to ${type}`);
      btn.addEventListener('click', () => applyPromotion(row, col, color, type));
      container.appendChild(btn);
    });
  }
  dialog.classList.remove('hidden');
}

function hidePromotionDialog() {
  document.getElementById('promotion-dialog')?.classList.add('hidden');
}

// ================================================================
// SECTION 14: GAME CONTROLS
// ================================================================

function setupControls() {
  document.getElementById('new-game-btn')?.addEventListener('click', () => {
    hideGameOver(); startNewGame();
  });

  document.getElementById('resign-btn')?.addEventListener('click', () => {
    if (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE ||
        state.status === STATUS.DRAW      || state.promotionPending) return;
    state.status = STATUS.CHECKMATE;
    state.winner = enemy(state.turn);
    playSound('gameover');
    updateStatusDisplay();
    renderBoard();
    setTimeout(() => showGameOver(STATUS.CHECKMATE, state.winner), 200);
  });

  document.getElementById('play-again-btn')?.addEventListener('click', () => {
    hideGameOver(); startNewGame();
  });
}

// ================================================================
// SECTION 15: INITIALIZATION
// ================================================================

function init() {
  setupControls();
  document.addEventListener('keydown', handleKeyDown);
  startNewGame();
  console.log('%c♟ OZAMA CHESS Engine v2.0 — Ready', 'color:#D4AF37;font-size:14px;font-weight:bold;');
}

/** Keyboard shortcuts: Escape = deselect, N = new game (when game over) */
function handleKeyDown(e) {
  if (e.key === 'Escape') {
    if (!state.promotionPending && state.status === STATUS.PLAYING || state.status === STATUS.CHECK) {
      state.selected = null; state.legalMoves = [];
      renderBoard();
    }
  }
  if ((e.key === 'n' || e.key === 'N') &&
      (state.status === STATUS.CHECKMATE || state.status === STATUS.STALEMATE || state.status === STATUS.DRAW)) {
    hideGameOver(); startNewGame();
  }
}

document.addEventListener('DOMContentLoaded', init);

// ================================================================
// SECTION 16: FUTURE HOOKS
// ================================================================

function flipBoard() {
  CONFIG.BOARD_FLIPPED = !CONFIG.BOARD_FLIPPED;
  renderBoard();
}

function onMovePlayed(moveData) {
  // TODO: socket.emit('move', moveData);
}

function triggerAIMove(difficulty = 'easy') {
  const aiColor = state.turn;
  const allMoves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (state.board[r][c]?.color === aiColor)
        getLegalMovesForSquare(state.board, r, c, state)
          .forEach(m => allMoves.push({ from: { row: r, col: c }, to: m }));
  if (allMoves.length > 0) {
    const pick = allMoves[Math.floor(Math.random() * allMoves.length)];
    setTimeout(() => executeMove(pick.from, pick.to), 400);
  }
}

function exportMoveList() {
  let pgn = ''; let moveNo = 1;
  for (const entry of state.moveHistory) {
    if (entry.piece.color === COLOR.WHITE) pgn += `${moveNo}. ${entry.notation} `;
    else { pgn += `${entry.notation} `; moveNo++; }
  }
  return pgn.trim();
}