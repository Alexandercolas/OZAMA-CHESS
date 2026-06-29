'use strict';

require('dotenv').config();

// ================================================================
//  OZAMA CHESS — server.js
// ================================================================

const express         = require('express');
const http            = require('http');
const { Server }      = require('socket.io');
const path            = require('path');
const mongoose        = require('mongoose');
const jwt             = require('jsonwebtoken');

const connectDatabase = require('./config/database');
const Match           = require('./models/Match');
const Room            = require('./models/Room');
const User            = require('./models/User');

const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/user');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

app.get('/api/health/db', (_req, res) => {
  res.json({
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    name:     mongoose.connection.name || null,
  });
});

app.get('/api/matches/recent', async (_req, res) => {
  try {
    const matches = await Match.find({ result: { $ne: 'in_progress' } })
      .sort({ createdAt: -1 }).limit(10)
      .select('roomCode whitePlayer blackPlayer result winner moves pgn startedAt endedAt createdAt')
      .lean();
    res.json(matches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Salas en memoria ─────────────────────────────────────────────
const rooms = new Map();

// ── Cola de matchmaking ──────────────────────────────────────────
// { socketId, playerInfo, joinedAt }
const matchQueue = [];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function cancelTimer(room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
}

// ── CLOCK SYSTEM ─────────────────────────────────────────────────
const DEFAULT_TIME_MS = 10 * 60 * 1000;

function stopClock(room) {
  if (room && room.clockInterval) { clearInterval(room.clockInterval); room.clockInterval = null; }
}

function startClock(code) {
  const room = rooms.get(code);
  if (!room) return;
  stopClock(room);
  room.clockInterval = setInterval(async () => {
    const turn = room.game?.turn;
    if (!turn) return;
    if (turn === 'w') room.clockW = Math.max(0, room.clockW - 1000);
    else              room.clockB = Math.max(0, room.clockB - 1000);
    io.to(code).emit('clock-tick', { w: room.clockW, b: room.clockB });
    const ranOut = turn === 'w' ? room.clockW === 0 : room.clockB === 0;
    if (ranOut) {
      stopClock(room);
      const winner = turn === 'w' ? 'b' : 'w';
      const result = winner === 'w' ? 'white_win' : 'black_win';
      io.to(code).emit('time-out', { loser: turn, winner });
      const closed = await finishMatch(room.matchId, result, winner);
      if (closed) await applyEloForRoom(room, result, code);
    }
  }, 1000);
}

function startCloseTimer(code) {
  const room = rooms.get(code);
  if (!room) return;
  cancelTimer(room);
  stopClock(room);
  room.timer = setTimeout(async () => {
    io.to(code).emit('opponent-timeout');
    if (room.matchId) {
      const winner = room.white ? 'w' : room.black ? 'b' : null;
      await finishMatch(room.matchId, winner ? (winner === 'w' ? 'white_win' : 'black_win') : 'abandoned', winner);
    }
    await Room.updateOne({ roomCode: code }, { $set: { status: 'closed', lastActivityAt: new Date() } }).catch(() => {});
    rooms.delete(code);
    console.log(`[X] Sala ${code} cerrada por timeout`);
  }, 30_000);
}

async function finishMatch(matchId, result, winner = null, pgn = '') {
  if (!matchId) return false;
  const set = { result, winner, endedAt: new Date() };
  if (pgn) set.pgn = pgn;
  const update = await Match.updateOne({ _id: matchId, result: 'in_progress' }, { $set: set })
    .catch((err) => { console.warn('[DB] No se pudo cerrar match:', err.message); return null; });
  return !!update.modifiedCount;
}

function playerSnapshot(info) {
  return {
    userId: info.userId || null,
    name: info.name || 'Jugador',
    country: info.country || 'DO',
    avatar: info.avatar || 0,
    elo: info.elo || 1200,
  };
}

const PIECE = { PAWN: 'p', KNIGHT: 'n', BISHOP: 'b', ROOK: 'r', QUEEN: 'q', KING: 'k' };
const COLOR = { WHITE: 'w', BLACK: 'b' };
const PROMOTION_PIECES = new Set([PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT]);

function createInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const backRank = [PIECE.ROOK, PIECE.KNIGHT, PIECE.BISHOP, PIECE.QUEEN, PIECE.KING, PIECE.BISHOP, PIECE.KNIGHT, PIECE.ROOK];
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

function createGameState() {
  return {
    board: createInitialBoard(),
    turn: COLOR.WHITE,
    castlingRights: { w: { kingside: true, queenside: true }, b: { kingside: true, queenside: true } },
    enPassantTarget: null,
    halfMoveClock: 0,
  };
}

function inBounds(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < 8 && col >= 0 && col < 8;
}

function enemy(color) {
  return color === COLOR.WHITE ? COLOR.BLACK : COLOR.WHITE;
}

function cloneBoard(board) {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

function findKing(board, color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece?.type === PIECE.KING && piece.color === color) return { row, col };
    }
  }
  return null;
}

function isSquareAttacked(board, row, col, byColor) {
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    const r = row + dr;
    const c = col + dc;
    if (inBounds(r, c) && board[r][c]?.color === byColor && board[r][c]?.type === PIECE.KNIGHT) return true;
  }

  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      const piece = board[r][c];
      if (piece) {
        if (piece.color === byColor && (piece.type === PIECE.BISHOP || piece.type === PIECE.QUEEN)) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      const piece = board[r][c];
      if (piece) {
        if (piece.color === byColor && (piece.type === PIECE.ROOK || piece.type === PIECE.QUEEN)) return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  const pawnRow = row + (byColor === COLOR.WHITE ? 1 : -1);
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (inBounds(pawnRow, c) && board[pawnRow][c]?.color === byColor && board[pawnRow][c]?.type === PIECE.PAWN) return true;
  }

  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
    const r = row + dr;
    const c = col + dc;
    if (inBounds(r, c) && board[r][c]?.color === byColor && board[r][c]?.type === PIECE.KING) return true;
  }

  return false;
}

function isInCheck(board, color) {
  const king = findKing(board, color);
  return king ? isSquareAttacked(board, king.row, king.col, enemy(color)) : false;
}

function getPseudoLegalMoves(board, row, col, game) {
  const piece = board[row][col];
  if (!piece) return [];
  if (piece.type === PIECE.PAWN) return getPawnMoves(board, row, col, piece.color, game);
  if (piece.type === PIECE.KNIGHT) return getKnightMoves(board, row, col, piece.color);
  if (piece.type === PIECE.BISHOP) return getSlidingMoves(board, row, col, piece.color, [[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  if (piece.type === PIECE.ROOK) return getSlidingMoves(board, row, col, piece.color, [[-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (piece.type === PIECE.QUEEN) return getSlidingMoves(board, row, col, piece.color, [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
  if (piece.type === PIECE.KING) return getKingMoves(board, row, col, piece.color, game);
  return [];
}

function getPawnMoves(board, row, col, color, game) {
  const moves = [];
  const dir = color === COLOR.WHITE ? -1 : 1;
  const startRow = color === COLOR.WHITE ? 6 : 1;
  const r1 = row + dir;
  if (inBounds(r1, col) && !board[r1][col]) {
    moves.push({ row: r1, col });
    const r2 = row + dir * 2;
    if (row === startRow && inBounds(r2, col) && !board[r2][col]) moves.push({ row: r2, col });
  }
  for (const dc of [-1, 1]) {
    const c = col + dc;
    if (inBounds(r1, c) && board[r1][c]?.color && board[r1][c]?.color !== color) moves.push({ row: r1, col: c });
  }
  const ep = game.enPassantTarget;
  if (ep && ep.row === r1 && Math.abs(ep.col - col) === 1) moves.push({ row: r1, col: ep.col, enPassant: true });
  return moves;
}

function getKnightMoves(board, row, col, color) {
  return [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter(({ row: r, col: c }) => inBounds(r, c) && board[r][c]?.color !== color);
}

function getSlidingMoves(board, row, col, color, directions) {
  const moves = [];
  for (const [dr, dc] of directions) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      if (board[r][c]) {
        if (board[r][c].color !== color) moves.push({ row: r, col: c });
        break;
      }
      moves.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
  }
  return moves;
}

function getKingMoves(board, row, col, color, game) {
  const moves = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]
    .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
    .filter(({ row: r, col: c }) => inBounds(r, c) && board[r][c]?.color !== color);
  moves.push(...getCastlingMoves(board, row, col, color, game));
  return moves;
}

function getCastlingMoves(board, row, col, color, game) {
  const moves = [];
  const rights = game.castlingRights[color];
  if (!rights || isInCheck(board, color)) return moves;
  if (rights.kingside && board[row][7]?.type === PIECE.ROOK && board[row][7]?.color === color && !board[row][5] && !board[row][6] && !isSquareAttacked(board, row, 5, enemy(color)) && !isSquareAttacked(board, row, 6, enemy(color))) {
    moves.push({ row, col: 6, castling: 'kingside' });
  }
  if (rights.queenside && board[row][0]?.type === PIECE.ROOK && board[row][0]?.color === color && !board[row][1] && !board[row][2] && !board[row][3] && !isSquareAttacked(board, row, 3, enemy(color)) && !isSquareAttacked(board, row, 2, enemy(color))) {
    moves.push({ row, col: 2, castling: 'queenside' });
  }
  return moves;
}

function wouldLeaveKingInCheck(board, from, to, color, game) {
  const tempBoard = cloneBoard(board);
  if (to.enPassant && game.enPassantTarget) tempBoard[from.row][game.enPassantTarget.col] = null;
  tempBoard[to.row][to.col] = tempBoard[from.row][from.col];
  tempBoard[from.row][from.col] = null;
  if (tempBoard[to.row][to.col]?.type === PIECE.KING && Math.abs(to.col - from.col) === 2) {
    if (to.col > from.col) {
      tempBoard[to.row][5] = tempBoard[to.row][7];
      tempBoard[to.row][7] = null;
    } else {
      tempBoard[to.row][3] = tempBoard[to.row][0];
      tempBoard[to.row][0] = null;
    }
  }
  return isInCheck(tempBoard, color);
}

function getLegalMovesForSquare(board, row, col, game) {
  const piece = board[row][col];
  if (!piece) return [];
  return getPseudoLegalMoves(board, row, col, game).filter(to => !wouldLeaveKingInCheck(board, { row, col }, to, piece.color, game));
}

function applyValidatedMove(game, from, to, promotion) {
  const piece = game.board[from.row][from.col];
  const capturedPiece = game.board[to.row][to.col] ? { ...game.board[to.row][to.col] } : null;
  const isEnPassant = !!to.enPassant;
  const isCapture = !!(capturedPiece || isEnPassant);
  if (isEnPassant && game.enPassantTarget) game.board[from.row][game.enPassantTarget.col] = null;

  game.board[to.row][to.col] = { ...piece };
  game.board[from.row][from.col] = null;

  if (to.castling === 'kingside') {
    game.board[to.row][5] = game.board[to.row][7];
    game.board[to.row][7] = null;
  } else if (to.castling === 'queenside') {
    game.board[to.row][3] = game.board[to.row][0];
    game.board[to.row][0] = null;
  }

  if (piece.type === PIECE.KING) {
    game.castlingRights[piece.color].kingside = false;
    game.castlingRights[piece.color].queenside = false;
  }
  if (piece.type === PIECE.ROOK) {
    if (from.col === 7) game.castlingRights[piece.color].kingside = false;
    if (from.col === 0) game.castlingRights[piece.color].queenside = false;
  }
  if (capturedPiece?.type === PIECE.ROOK) {
    if (to.col === 7) game.castlingRights[capturedPiece?.color].kingside = false;
    if (to.col === 0) game.castlingRights[capturedPiece?.color].queenside = false;
  }

  const backRank = piece.color === COLOR.WHITE ? 0 : 7;
  if (piece.type === PIECE.PAWN && to.row === backRank) {
    game.board[to.row][to.col] = { type: PROMOTION_PIECES.has(promotion) ? promotion : PIECE.QUEEN, color: piece.color };
  }

  game.enPassantTarget = null;
  if (piece.type === PIECE.PAWN && Math.abs(to.row - from.row) === 2) {
    game.enPassantTarget = { row: (from.row + to.row) / 2, col: from.col };
  }
  game.halfMoveClock = piece.type === PIECE.PAWN || isCapture ? 0 : game.halfMoveClock + 1;
  game.turn = enemy(piece.color);
}

function validateAndApplyMove(game, playerColor, from, to, promotion) {
  if (!game || playerColor !== game.turn) return { ok: false, message: 'No es tu turno.' };
  if (!inBounds(from.row, from.col) || !inBounds(to.row, to.col)) return { ok: false, message: 'Movimiento inválido.' };

  const piece = game.board[from.row][from.col];
  if (!piece || piece.color !== playerColor) return { ok: false, message: 'Pieza inválida.' };

  const legalMove = getLegalMovesForSquare(game.board, from.row, from.col, game)
    .find(move => move.row === to.row && move.col === to.col);
  if (!legalMove) return { ok: false, message: 'Movimiento ilegal.' };

  const serverTo = { row: legalMove.row, col: legalMove.col };
  if (legalMove.castling) serverTo.castling = legalMove.castling;
  if (legalMove.enPassant) serverTo.enPassant = true;

  const backRank = piece.color === COLOR.WHITE ? 0 : 7;
  const serverPromotion = piece.type === PIECE.PAWN && serverTo.row === backRank
    ? (PROMOTION_PIECES.has(promotion) ? promotion : PIECE.QUEEN)
    : null;

  applyValidatedMove(game, { row: from.row, col: from.col }, serverTo, serverPromotion);
  return { ok: true, from: { row: from.row, col: from.col }, to: serverTo, promotion: serverPromotion };
}

async function applyEloForRoom(room, result, code) {
  const wInfo = room.playerInfo.w;
  const bInfo = room.playerInfo.b;
  if (!room.matchId || !wInfo.userId || !bInfo.userId || result === 'abandoned') return;

  try {
    const [wUser, bUser] = await Promise.all([User.findById(wInfo.userId), User.findById(bInfo.userId)]);
    if (!wUser || !bUser) return;

    const wResult = result === 'white_win' ? 1 : result === 'draw' ? 0.5 : 0;
    const bResult = 1 - wResult;
    const wBefore = wUser.elo;
    const bBefore = bUser.elo;

    wUser.updateElo(bBefore, wResult);
    bUser.updateElo(wBefore, bResult);

    if (result === 'white_win')      { wUser.stats.wins++;  bUser.stats.losses++; }
    else if (result === 'black_win') { bUser.stats.wins++;  wUser.stats.losses++; }
    else                             { wUser.stats.draws++; bUser.stats.draws++;  }

    await Promise.all([
      wUser.save({ validateModifiedOnly: true }),
      bUser.save({ validateModifiedOnly: true }),
      Match.updateOne({ _id: room.matchId }, { $set: {
        'whitePlayer.elo': wUser.elo,
        'blackPlayer.elo': bUser.elo,
        'eloChange.white': wUser.elo - wBefore,
        'eloChange.black': bUser.elo - bBefore,
      }}),
    ]);

    room.playerInfo.w.elo = wUser.elo;
    room.playerInfo.b.elo = bUser.elo;

    io.to(code).emit('elo-update', {
      w: { newElo: wUser.elo, change: wUser.elo - wBefore },
      b: { newElo: bUser.elo, change: bUser.elo - bBefore },
    });
    console.log(`[ELO] ${wUser.username}: ${wBefore}→${wUser.elo} | ${bUser.username}: ${bBefore}→${bUser.elo}`);
  } catch (err) {
    console.warn('[ELO] Error:', err.message);
  }
}

// ── Socket JWT middleware ──────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (token) {
    try {
      const decoded      = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.userId = decoded.id;
    } catch (_) {}
  }
  next();
});

// ================================================================
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id} ${socket.data.userId ? '(auth)' : '(anon)'}`);

  async function getPlayerInfo(playerName, fallbackCountry = 'DO') {
    if (socket.data.userId) {
      const user = await User.findById(socket.data.userId).select('username country avatar elo').lean();
      if (user) return { userId: user._id, name: user.username, country: user.country, avatar: user.avatar, elo: user.elo };
    }
    return { userId: null, name: playerName || 'Jugador', country: fallbackCountry, avatar: 0, elo: 1200 };
  }

  async function createMatchBetween(wSocket, wInfo, bSocket, bInfo, code) {
    rooms.set(code, {
      white: wSocket.id, black: bSocket.id,
      currentTurn: 'w', rematchReady: new Set(),
      timer: null, playerInfo: { w: wInfo, b: bInfo }, matchId: null,
      game: createGameState(),
      clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, clockInterval: null,
    });

    const room = rooms.get(code);

    const match = await Match.create({
      whitePlayer: playerSnapshot(wInfo),
      blackPlayer: playerSnapshot(bInfo),
      roomCode: code, result: 'in_progress', startedAt: new Date(),
    }).catch((err) => { console.warn('[DB] Match create error:', err.message); return null; });

    if (match) room.matchId = match._id;

    await Room.findOneAndUpdate(
      { roomCode: code },
      { $set: {
        roomCode: code,
        'players.white.socketId': wSocket.id, 'players.white.userId': wInfo.userId, 'players.white.name': wInfo.name, 'players.white.country': wInfo.country, 'players.white.avatar': wInfo.avatar,
        'players.black.socketId': bSocket.id, 'players.black.userId': bInfo.userId, 'players.black.name': bInfo.name, 'players.black.country': bInfo.country, 'players.black.avatar': bInfo.avatar,
        match: match._id || null, fen: 'startpos', turn: 'w', status: 'playing', lastActivityAt: new Date(),
      }},
      { upsert: true, new: true }
    ).catch(() => {});

    wSocket.join(code); wSocket.data.roomCode = code; wSocket.data.color = 'w'; wSocket.data.playerName = wInfo.name;
    bSocket.join(code); bSocket.data.roomCode = code; bSocket.data.color = 'b'; bSocket.data.playerName = bInfo.name;

    wSocket.emit('game-start', { code, color: 'w', playerInfo: { w: wInfo, b: bInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    bSocket.emit('game-start', { code, color: 'b', playerInfo: { w: wInfo, b: bInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    startClock(code);

    console.log(`[MM] Partida creada: ${wInfo.name} (w) vs ${bInfo.name} (b) — sala ${code}`);
  }

  // ── MATCHMAKING: unirse a la cola ─────────────────────────────
  socket.on('quick-match', async ({ playerName = 'Jugador', country = 'DO' } = {}) => {
    const existingIdx = matchQueue.findIndex(e => e.socketId === socket.id);
    if (existingIdx !== -1) matchQueue.splice(existingIdx, 1);

    const pInfo = await getPlayerInfo(playerName, country);
    socket.data.playerName = pInfo.name;

    const rivalIdx = matchQueue.findIndex(e => {
      if (e.socketId === socket.id) return false;
      if (pInfo.userId && e.playerInfo.userId.toString() === pInfo.userId.toString()) return false;
      const rivalSocket = io.sockets.sockets.get(e.socketId);
      return rivalSocket.connected;
    });

    if (rivalIdx !== -1) {
      const [rival] = matchQueue.splice(rivalIdx, 1);
      const rivalSocket = io.sockets.sockets.get(rival.socketId);

      if (!rivalSocket.connected) {
        matchQueue.push({ socketId: socket.id, playerInfo: pInfo, joinedAt: Date.now() });
        socket.emit('matchmaking-searching', { position: matchQueue.length });
        return;
      }

      let code;
      do { code = generateCode(); } while (rooms.has(code));

      const flip = Math.random() < 0.5;
      const wInfo = flip ? pInfo       : rival.playerInfo;
      const bInfo = flip ? rival.playerInfo : pInfo;
      const wSock = flip ? socket      : rivalSocket;
      const bSock = flip ? rivalSocket : socket;

      await createMatchBetween(wSock, wInfo, bSock, bInfo, code);

    } else {
      matchQueue.push({ socketId: socket.id, playerInfo: pInfo, joinedAt: Date.now() });
      socket.emit('matchmaking-searching', { position: matchQueue.length });
      console.log(`[MM] ${pInfo.name} en cola. Cola: ${matchQueue.length}`);
    }
  });

  // ── MATCHMAKING: salir de la cola ─────────────────────────────
  socket.on('quick-match-cancel', () => {
    const idx = matchQueue.findIndex(e => e.socketId === socket.id);
    if (idx !== -1) matchQueue.splice(idx, 1);
    socket.emit('matchmaking-cancelled');
    console.log(`[MM] ${socket.data.playerName || socket.id} salió de la cola`);
  });

  // ── Crear sala ────────────────────────────────────────────────
  socket.on('create-room', async ({ playerName = 'Jugador 1', country = 'DO' } = {}) => {
    let code;
    do { code = generateCode(); } while (rooms.has(code));

    const pInfo = await getPlayerInfo(playerName, country);

    rooms.set(code, {
      white: socket.id, black: null,
      currentTurn: 'w', rematchReady: new Set(),
      timer: null, playerInfo: { w: pInfo, b: null }, matchId: null,
      game: createGameState(),
      clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, clockInterval: null,
    });

    socket.join(code);
    socket.data.roomCode   = code;
    socket.data.color      = 'w';
    socket.data.playerName = pInfo.name;

    socket.emit('room-created', { code, color: 'w', playerInfo: pInfo });

    await Room.findOneAndUpdate(
      { roomCode: code },
      { $set: {
        roomCode: code,
        'players.white.socketId': socket.id, 'players.white.userId': pInfo.userId,
        'players.white.name': pInfo.name,    'players.white.country': pInfo.country, 'players.white.avatar': pInfo.avatar,
        'players.black.socketId': null, 'players.black.name': '',
        fen: 'startpos', turn: 'w', status: 'waiting', lastActivityAt: new Date(),
      }},
      { upsert: true, new: true }
    ).catch((err) => console.warn('[DB] No se pudo guardar sala:', err.message));

    console.log(`[R] Sala ${code} creada por "${pInfo.name}" (${pInfo.country})`);
  });

  // ── Unirse a sala ─────────────────────────────────────────────
  socket.on('join-room', async ({ code, playerName = 'Jugador 2', country = 'DO' }) => {
    const cleanCode = (code || '').toUpperCase().trim();
    const room      = rooms.get(cleanCode);

    if (!room)                    { socket.emit('room-error', 'Sala no encontrada.'); return; }
    if (room.white === socket.id) { socket.emit('room-error', 'No puedes unirte a tu propia sala.'); return; }
    if (room.black)               { socket.emit('room-error', 'La sala ya está llena.'); return; }

    const pInfo = await getPlayerInfo(playerName, country);
    cancelTimer(room);
    room.black        = socket.id;
    room.playerInfo.b = pInfo;

    const wInfo = room.playerInfo.w;
    const match = await Match.create({
      whitePlayer: playerSnapshot(wInfo),
      blackPlayer: playerSnapshot(pInfo),
      roomCode: cleanCode, result: 'in_progress', startedAt: new Date(),
    }).catch((err) => { console.warn('[DB] No se pudo crear match:', err.message); return null; });

    if (match) room.matchId = match._id;

    await Room.updateOne({ roomCode: cleanCode }, { $set: {
      'players.black.socketId': socket.id, 'players.black.userId': pInfo.userId,
      'players.black.name': pInfo.name,    'players.black.country': pInfo.country, 'players.black.avatar': pInfo.avatar,
      match: match._id || null, turn: room.currentTurn, status: 'playing', lastActivityAt: new Date(),
    }}).catch((err) => console.warn('[DB] No se pudo actualizar sala:', err.message));

    socket.join(cleanCode);
    socket.data.roomCode   = cleanCode;
    socket.data.color      = 'b';
    socket.data.playerName = pInfo.name;

    socket.emit('room-joined', { code: cleanCode, color: 'b', playerInfo: pInfo });
    io.to(room.white).emit('game-start', { code: cleanCode, color: 'w', playerInfo: { w: wInfo, b: pInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    socket.emit('game-start',            { code: cleanCode, color: 'b', playerInfo: { w: wInfo, b: pInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    startClock(cleanCode);

    console.log(`[R] Sala ${cleanCode} — ${wInfo.name} vs ${pInfo.name}`);
  });

  // ── Reconexión ────────────────────────────────────────────────
  socket.on('rejoin', async ({ roomCode, color, playerName }) => {
    const room = rooms.get(roomCode);
    if (!room) { socket.emit('rejoin-failed', 'La sala ya no existe.'); return; }

    cancelTimer(room);
    socket.join(roomCode);
    socket.data.roomCode   = roomCode;
    socket.data.color      = color;
    socket.data.playerName = playerName || '';

    if (color === 'w') room.white = socket.id;
    else               room.black = socket.id;

    await Room.updateOne({ roomCode }, { $set: {
      [`players.${color === 'w' ? 'white' : 'black'}.socketId`]: socket.id,
      lastActivityAt: new Date(),
    }}).catch(() => {});

    socket.emit('rejoin-ok', {
      playerInfo: room.playerInfo,
      currentTurn: room.currentTurn,
      clockW: room.clockW || DEFAULT_TIME_MS,
      clockB: room.clockB || DEFAULT_TIME_MS,
    });
    socket.to(roomCode).emit('opponent-reconnected', { playerName: socket.data.playerName });
    // Si ambos jugadores están en sala, reanudar reloj
if (room.white && room.black && !room.clockInterval) {
  startClock(roomCode);
}
    console.log(`[R] ${color.toUpperCase()} reconectado a sala ${roomCode}`);
  });

  // ── Movida ────────────────────────────────────────────────────
  socket.on('player-move', async ({ room: code, from, to, promotion }) => {
    if (!code || !from || !to) return;
    const room = rooms.get(code);
    if (!room) { socket.emit('move-rejected', 'La sala ya no existe.'); return; }

    const playerColor = socket.data.color;
    const roomSockets = [...(io.sockets.adapter.rooms.get(code) || [])];
    const opponentSocketId = playerColor === 'w' ? room.black : playerColor === 'b' ? room.white : null;
    const opponentSocket = opponentSocketId ? io.sockets.sockets.get(opponentSocketId) : null;
    console.log('[MOVE:SERVER:IN]', {
      socketId: socket.id, room: code, socketRoom: socket.data.roomCode,
      color: playerColor, turn: room.game?.turn, from, to, promotion,
      joinedRooms: [...socket.rooms], roomWhite: room.white, roomBlack: room.black,
      roomSockets,
    });

    if (!room.game) {
      socket.emit('move-rejected', 'Estado de sala inválido.'); return;
    }
    if (!socket.rooms.has(code)) {
      socket.emit('move-rejected', 'Socket fuera de la sala.'); return;
    }
    if (!opponentSocket?.connected || !opponentSocket.rooms.has(code)) {
      socket.emit('move-rejected', 'Rival no conectado a la sala.'); return;
    }

    let validation;
    try {
      validation = validateAndApplyMove(room.game, playerColor, from, to, promotion);
    } catch (err) {
      socket.emit('move-rejected', 'Error validando movimiento.'); return;
    }
    if (!validation.ok) {
      socket.emit('move-rejected', validation.message); return;
    }

    room.currentTurn = room.game.turn;
    socket.to(code).emit('opponent-move', {
      from: validation.from,
      to: validation.to,
      promotion: validation.promotion,
    });

    if (room.matchId) {
      Match.updateOne({ _id: room.matchId }, { $push: {
        moves: { from: validation.from, to: validation.to, promotion: validation.promotion, playedBy: playerColor, playedAt: new Date() },
      }}).catch(() => {});
    }
    Room.updateOne({ roomCode: code }, { $set: { turn: room.currentTurn, lastActivityAt: new Date() } }).catch(() => {});
  });

  // ── Chat ──────────────────────────────────────────────────────
  socket.on('chat-message', ({ room: code, message }) => {
    if (!code || !message) return;
    const clean = String(message).trim().slice(0, 200);
    if (!clean || !rooms.get(code)) return;
    io.to(code).emit('chat-message', {
      from: socket.data.playerName || 'Anónimo',
      color: socket.data.color,
      message: clean,
      timestamp: Date.now(),
    });
  });

  // ── Abandonar ─────────────────────────────────────────────────
  socket.on('player-resign', async ({ room: code, pgn = '' } = {}) => {
    const room   = rooms.get(code);
    if (!room) return;
    stopClock(room);
    const loser  = socket.data.color;
    const winner = loser === 'w' ? 'b' : loser === 'b' ? 'w' : null;
    if (room.matchId && winner) {
      const result = winner === 'w' ? 'white_win' : 'black_win';
      const closed = await finishMatch(room.matchId, result, winner, pgn);
      if (closed) await applyEloForRoom(room, result, code);
      await Room.updateOne({ roomCode: code }, { $set: { status: 'finished', lastActivityAt: new Date() } }).catch(() => {});
    }
    socket.to(code).emit('opponent-resigned', { playerName: socket.data.playerName });
    console.log(`[!] ${loser.toUpperCase()} abandonó sala ${code}`);
  });

  // ── Partida finalizada ────────────────────────────────────────
  socket.on('game-finished', async ({ room: code, result, winner = null, pgn = '' } = {}) => {
    const room = rooms.get(code);
    if (!room || !room.matchId) return;
    stopClock(room);

    const validResults = new Set(['white_win', 'black_win', 'draw', 'abandoned']);
    const validWinners = new Set(['w', 'b', null]);
    if (!validResults.has(result) || !validWinners.has(winner)) return;

    const closed = await finishMatch(room.matchId, result, winner, pgn);
    if (!closed) return;
    await Room.updateOne({ roomCode: code }, { $set: { status: 'finished', lastActivityAt: new Date() } }).catch(() => {});

    await applyEloForRoom(room, result, code);
    console.log(`[G] Partida ${code} finalizada: ${result}${winner ? ` (${winner})` : ''}`);
  });

  // ── Revancha ──────────────────────────────────────────────────
  socket.on('rematch-request', ({ room: code }) => {
    const room = rooms.get(code);
    if (!room) return;
    room.rematchReady.add(socket.id);
    socket.to(code).emit('rematch-requested', { playerName: socket.data.playerName });
  });

  socket.on('rematch-accept', async ({ room: code }) => {
    const room = rooms.get(code);
    if (!room) return;
    room.rematchReady.add(socket.id);
    if (room.rematchReady.size >= 2) {
      stopClock(room);
      room.currentTurn  = 'w';
      room.rematchReady = new Set();
      room.game = createGameState();
      room.clockW = DEFAULT_TIME_MS;
      room.clockB = DEFAULT_TIME_MS;
      const wInfo = room.playerInfo.w;
      const bInfo = room.playerInfo.b;
      const match = await Match.create({
        whitePlayer: wInfo ? playerSnapshot(wInfo) : { name: 'White' },
        blackPlayer: bInfo ? playerSnapshot(bInfo) : { name: 'Black' },
        roomCode: code, result: 'in_progress', startedAt: new Date(),
      }).catch(() => null);
      if (match) room.matchId = match._id;
      await Room.updateOne({ roomCode: code }, { $set: {
        match: match._id || room.matchId || null, turn: 'w', status: 'playing', lastActivityAt: new Date(),
      }}).catch(() => {});
      io.to(code).emit('rematch-start', { clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
      startClock(code);
      console.log(`[R] Revancha en sala ${code}`);
    }
  });

  socket.on('rematch-decline', ({ room: code }) => {
    const room = rooms.get(code);
    if (room) room.rematchReady = new Set();
    socket.to(code).emit('rematch-declined');
  });

  // ── Buscar usuario online ─────────────────────────────────────
  socket.on('search-user', async ({ username }) => {
    if (!username || username.trim().length < 2) {
      socket.emit('search-user-result', { error: 'Ingresa al menos 2 caracteres.' });
      return;
    }
    try {
      const user = await User.findOne({
        username: { $regex: username.trim(), $options: 'i' }
      }).select('username country elo stats').lean();

      if (!user) {
        socket.emit('search-user-result', { error: 'Usuario no encontrado.' });
        return;
      }

      let isOnline = false;
      for (const [, s] of io.sockets.sockets) {
        if (s.data.userId && s.data.userId.toString() === user._id.toString()) {
          isOnline = true; break;
        }
      }

      socket.emit('search-user-result', { user: { ...user, isOnline } });
    } catch (err) {
      socket.emit('search-user-result', { error: 'Error buscando usuario.' });
    }
  });

  // ── Enviar desafío ────────────────────────────────────────────
  socket.on('challenge-send', async ({ targetUsername }) => {
    if (!socket.data.userId) {
      socket.emit('challenge-error', 'Debes iniciar sesión para desafiar.');
      return;
    }

    let targetSocket = null;
    for (const [, s] of io.sockets.sockets) {
      const tUser = await User.findById(s.data.userId).select('username').lean().catch(() => null);
      if (tUser && tUser.username.toLowerCase() === targetUsername.toLowerCase()) {
        targetSocket = s; break;
      }
    }

    if (!targetSocket) {
      socket.emit('challenge-error', 'El jugador no está conectado en este momento.');
      return;
    }

    if (targetSocket.id === socket.id) {
      socket.emit('challenge-error', 'No puedes desafiarte a ti mismo.');
      return;
    }

    if (targetSocket.data.roomCode) {
      socket.emit('challenge-error', 'El jugador ya está en una partida.');
      return;
    }

    const challenger = await User.findById(socket.data.userId).select('username country elo').lean();

    targetSocket.emit('challenge-received', {
      from: { username: challenger.username, country: challenger.country, elo: challenger.elo },
      socketId: socket.id,
    });

    socket.emit('challenge-sent', { to: targetUsername });
    console.log(`[C] ${challenger.username} desafió a ${targetUsername}`);
  });

  // ── Aceptar desafío ───────────────────────────────────────────
  socket.on('challenge-accept', async ({ challengerSocketId }) => {
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (!challengerSocket || !challengerSocket.connected) {
      socket.emit('challenge-error', 'El rival ya no está disponible.');
      return;
    }

    const pInfo = await getPlayerInfo();
    const cInfo = await (async () => {
      if (challengerSocket.data.userId) {
        const u = await User.findById(challengerSocket.data.userId).select('username country avatar elo').lean();
        if (u) return { userId: u._id, name: u.username, country: u.country, avatar: u.avatar, elo: u.elo };
      }
      return { userId: null, name: challengerSocket.data.playerName || 'Jugador', country: 'DO', avatar: 0, elo: 1200 };
    })();

    let code;
    do { code = generateCode(); } while (rooms.has(code));

    const flip  = Math.random() < 0.5;
    const wSock = flip ? challengerSocket : socket;
    const bSock = flip ? socket : challengerSocket;
    const wInfo = flip ? cInfo : pInfo;
    const bInfo = flip ? pInfo : cInfo;

    await createMatchBetween(wSock, wInfo, bSock, bInfo, code);
  });

  // ── Rechazar desafío ──────────────────────────────────────────
  socket.on('challenge-decline', ({ challengerSocketId }) => {
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (challengerSocket) {
      challengerSocket.emit('challenge-declined', { by: socket.data.playerName || 'El jugador' });
    }
  });

  // ── Desconexión ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const qIdx = matchQueue.findIndex(e => e.socketId === socket.id);
    if (qIdx !== -1) matchQueue.splice(qIdx, 1);

    const code = socket.data.roomCode;
    if (!code) { console.log(`[-] Desconectado: ${socket.id} (sin sala)`); return; }

    const room = rooms.get(code);
    if (!room) return;

    console.log(`[-] ${socket.data.color ? socket.data.color.toUpperCase() : '?'} salió de sala ${code}`);
    if (room.white === socket.id) room.white = null;
    if (room.black === socket.id) room.black = null;

    if (!room.white && !room.black) { startCloseTimer(code); return; }
    socket.to(code).emit('opponent-disconnected');
    startCloseTimer(code);
  });
});
// ================================================================

const PORT = process.env.PORT || 3000;
connectDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log('');
      console.log('OZAMA CHESS - Servidor corriendo');
      console.log(`http://localhost:${PORT}/lobby.html`);
    });
  })
  .catch((err) => {
    console.error('[DB] Error conectando MongoDB Atlas:', err.message);
    process.exit(1);
  });