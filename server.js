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
const crypto          = require('crypto');
const { z }           = require('zod');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { protectCookieWrites, socketToken } = require('./middleware/session');

const connectDatabase = require('./config/database');
const Match           = require('./models/Match');
const Room            = require('./models/Room');
const User            = require('./models/User');

const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/user');
const adminRoutes     = require('./routes/admin');
const eventRoutes     = require('./routes/events');

const OzamaCheckers   = require('./public/checkers-engine.js');

function checkRuntimeConfig() {
  const isProduction = process.env.NODE_ENV === 'production';
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) {
    const message = `[SECURITY] Variables faltantes: ${missing.join(', ')}`;
    if (isProduction) throw new Error(message);
    console.warn(message);
  }
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    const message = '[SECURITY] JWT_SECRET debe tener al menos 32 caracteres.';
    if (isProduction) throw new Error(message);
    console.warn(message);
  }
}

checkRuntimeConfig();

const ALLOWED_APP_ORIGINS = new Set([
  'https://ozama-chess.onrender.com',
  'https://localhost',
  'capacitor://localhost',
  ...String(process.env.APP_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function appOriginAllowed(origin) {
  if (!origin) return true;
  if (ALLOWED_APP_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch (_) {
    return false;
  }
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  maxHttpBufferSize: 100_000,
  perMessageDeflate: false,
  cors: {
    origin(origin, callback) {
      if (appOriginAllowed(origin)) return callback(null, true);
      return callback(new Error('Origen no permitido.'));
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: true,
  },
});

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('io', io);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && appOriginAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return appOriginAllowed(origin) ? res.sendStatus(204) : res.sendStatus(403);
  }
  return next();
});
app.use(express.json({ limit: '600kb' }));
app.use((req, res, next) => {
  const googleLoginEnabled = req.path === '/login.html'
    && Boolean(String(process.env.GOOGLE_WEB_CLIENT_ID || '').trim());
  const googleScript = googleLoginEnabled ? ' https://accounts.google.com/gsi/client' : '';
  const googleParent = googleLoginEnabled ? ' https://accounts.google.com/gsi/' : '';
  const googleStyle = googleLoginEnabled ? ' https://accounts.google.com/gsi/style' : '';
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-DNS-Prefetch-Control', 'off');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.set('Cross-Origin-Opener-Policy', googleLoginEnabled ? 'same-origin-allow-popups' : 'same-origin');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src 'self' 'unsafe-inline'${googleScript}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${googleStyle}`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://flagcdn.com",
    "media-src 'self'",
    `frame-src 'self'${googleParent}`,
    `connect-src 'self' ws: wss:${googleParent}`,
  ].join('; '));
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});
app.use('/api', protectCookieWrites);
app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventRoutes);

app.get('/api/health/db', (_req, res) => {
  res.json({
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.get('/api/matches/recent', async (_req, res) => {
  try {
    const matches = await Match.find({ result: { $ne: 'in_progress' } })
      .sort({ createdAt: -1 }).limit(10)
      .select('whitePlayer.name blackPlayer.name result winner startedAt endedAt createdAt')
      .lean();
    res.json(matches);
  } catch (err) {
    console.error('[Matches] Recent:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── Salas en memoria ─────────────────────────────────────────────
const rooms = new Map();
// Salas de Damas: namespace completamente separado de `rooms` (ajedrez).
// Ningun handler de ajedrez lee ni escribe este Map, y viceversa.
const damasRooms = new Map();
const onlinePlayers = new Map();
const pendingChallenges = new Map();
const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const roomCodeSchema = z.string().trim().toUpperCase().regex(ROOM_CODE_PATTERN).max(6);
const squareSchema = z.object({
  row: z.number().int().min(0).max(7),
  col: z.number().int().min(0).max(7),
}).strict();
const pgnSchema = z.string().max(20_000).optional().default('');
const socketLimiters = {
  createRoom: new RateLimiterMemory({ points: 5, duration: 60 }),
  joinRoom: new RateLimiterMemory({ points: 12, duration: 60 }),
  challengeSend: new RateLimiterMemory({ points: 10, duration: 60 }),
  playerMove: new RateLimiterMemory({ points: 80, duration: 60 }),
  damasCreateRoom: new RateLimiterMemory({ points: 5, duration: 60 }),
  damasJoinRoom: new RateLimiterMemory({ points: 12, duration: 60 }),
  damasMove: new RateLimiterMemory({ points: 80, duration: 60 }),
};

const damasSquareSchema = z.number().int().min(0).max(7);
const damasStepSchema = z.object({
  toR: damasSquareSchema, toC: damasSquareSchema,
  capturedR: z.number().int().min(-1).max(7), capturedC: z.number().int().min(-1).max(7),
}).strict();
const damasSchemas = {
  createRoom: z.object({ playerName: z.string().max(30).optional(), country: z.string().max(2).optional() }).strict().default({}),
  joinRoom: z.object({ code: roomCodeSchema, playerName: z.string().max(30).optional(), country: z.string().max(2).optional() }).strict(),
  move: z.object({
    room: roomCodeSchema,
    fromR: damasSquareSchema, fromC: damasSquareSchema,
    seq: z.array(damasStepSchema).min(1).max(12),
  }).strict(),
  roomOnly: z.object({ room: roomCodeSchema }).strict(),
};

// ── Cola de matchmaking ──────────────────────────────────────────
// { socketId, playerInfo, joinedAt }
const matchQueue = [];

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoomToken() {
  return crypto.randomBytes(24).toString('hex');
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
      room.status = 'finished';
      const winner = turn === 'w' ? 'b' : 'w';
      const result = winner === 'w' ? 'white_win' : 'black_win';
      io.to(code).emit('time-out', { loser: turn, winner });
      const closed = await finishMatch(room.matchId, result, winner);
      if (closed) await applyEloForRoom(room, result, code);
      await Room.updateOne({ roomCode: code }, { $set: { status: 'finished', lastActivityAt: new Date() } }).catch(() => {});
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
      const result = winner ? (winner === 'w' ? 'white_win' : 'black_win') : 'abandoned';
      const closed = await finishMatch(room.matchId, result, winner);
      if (closed && winner) await applyEloForRoom(room, result, code);
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

async function finishRoomByServerConclusion(room, code, source = 'server') {
  if (!room || room.status !== 'playing' || !room.matchId) return null;
  const conclusion = getServerGameConclusion(room.game);
  if (!conclusion) return null;

  stopClock(room);
  room.status = 'finished';
  const closed = await finishMatch(room.matchId, conclusion.result, conclusion.winner);
  if (!closed) return null;

  await Room.updateOne({ roomCode: code }, {
    $set: { status: 'finished', lastActivityAt: new Date() },
  }).catch(() => {});
  await applyEloForRoom(room, conclusion.result, code);

  io.to(code).emit('game-finished', {
    result: conclusion.result,
    winner: conclusion.winner,
    reason: conclusion.reason,
    source,
  });
  console.log(`[G] Partida ${code} finalizada por servidor: ${conclusion.result}${conclusion.winner ? ` (${conclusion.winner})` : ''}`);
  return conclusion;
}

function playerSnapshot(info) {
  return {
    userId: info.userId || null,
    name: info.name || 'Jugador',
    country: info.country || 'DO',
    avatar: info.avatar || 0,
    avatarImage: info.avatarImage || '',
    elo: info.elo || 1200,
  };
}

function broadcastOnlinePlayers() {
  io.emit('players-online', [...onlinePlayers.values()]);
}

function adminRoomSnapshot(code, room) {
  const connected = io.sockets.adapter.rooms.get(code)?.size || 0;
  const player = (info, socketId) => info ? {
    name: info.name || 'Jugador',
    country: info.country || 'DO',
    elo: Number(info.elo || 1200),
    connected: !!socketId,
  } : null;
  return {
    code,
    status: room.status || 'waiting',
    turn: room.game?.turn || room.currentTurn || 'w',
    clockW: Number(room.clockW || 0),
    clockB: Number(room.clockB || 0),
    connected,
    matchId: room.matchId ? String(room.matchId) : null,
    white: player(room.playerInfo?.w, room.white),
    black: player(room.playerInfo?.b, room.black),
  };
}

function adminRuntimeSnapshot() {
  const activeRooms = [...rooms.values()].filter((room) => ['waiting', 'playing'].includes(room.status)).length;
  const authenticatedUsers = new Set(
    [...io.sockets.sockets.values()]
      .map((socket) => socket.data.userId && String(socket.data.userId))
      .filter(Boolean)
  );
  return {
    socketConnections: io.sockets.sockets.size,
    onlineUsers: authenticatedUsers.size,
    activeRooms,
    waitingPlayers: matchQueue.length,
  };
}

function adminActiveRooms() {
  return [...rooms.entries()]
    .filter(([, room]) => ['waiting', 'playing'].includes(room.status))
    .map(([code, room]) => adminRoomSnapshot(code, room))
    .sort((a, b) => a.code.localeCompare(b.code));
}

async function adminCloseRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return null;
  const snapshot = adminRoomSnapshot(code, room);

  cancelTimer(room);
  stopClock(room);
  room.status = 'closed';
  if (room.matchId) await finishMatch(room.matchId, 'abandoned', null);
  await Room.updateOne({ roomCode: code }, {
    $set: { status: 'closed', lastActivityAt: new Date() },
  }).catch((err) => console.warn('[Admin] No se pudo cerrar Room:', err.message));

  const socketIds = [...(io.sockets.adapter.rooms.get(code) || [])];
  for (const socketId of socketIds) {
    const roomSocket = io.sockets.sockets.get(socketId);
    if (!roomSocket) continue;
    roomSocket.emit('room-closed', { reason });
    roomSocket.leave(code);
    roomSocket.data.roomCode = null;
    roomSocket.data.color = null;
    const online = onlinePlayers.get(socketId);
    if (online) online.inGame = false;
  }

  rooms.delete(code);
  broadcastOnlinePlayers();
  console.warn(`[Admin] Sala ${code} cerrada manualmente`);
  return snapshot;
}

function adminDisconnectUser(userId) {
  let disconnected = 0;
  for (const socket of io.sockets.sockets.values()) {
    if (!sameId(socket.data.userId, userId)) continue;
    socket.emit('auth-error', 'Tu sesion fue cerrada por administracion.');
    socket.disconnect(true);
    disconnected += 1;
  }
  return disconnected;
}

app.locals.adminRuntime = {
  snapshot: adminRuntimeSnapshot,
  rooms: adminActiveRooms,
  closeRoom: adminCloseRoom,
  disconnectUser: adminDisconnectUser,
};

const PIECE = { PAWN: 'p', KNIGHT: 'n', BISHOP: 'b', ROOK: 'r', QUEEN: 'q', KING: 'k' };
const COLOR = { WHITE: 'w', BLACK: 'b' };
const PROMOTION_PIECES = new Set([PIECE.QUEEN, PIECE.ROOK, PIECE.BISHOP, PIECE.KNIGHT]);
const colorSchema = z.enum([COLOR.WHITE, COLOR.BLACK, 'white', 'black']).transform((value) => {
  if (value === 'white') return COLOR.WHITE;
  if (value === 'black') return COLOR.BLACK;
  return value;
});
const socketSchemas = {
  quickMatch: z.object({ playerName: z.string().max(30).optional(), country: z.string().max(2).optional() }).strict().default({}),
  createRoom: z.object({ playerName: z.string().max(30).optional(), country: z.string().max(2).optional() }).strict().default({}),
  joinRoom: z.object({ code: roomCodeSchema, playerName: z.string().max(30).optional(), country: z.string().max(2).optional() }).strict(),
  rejoin: z.object({ roomCode: roomCodeSchema, color: colorSchema, token: z.string().length(48) }).strict(),
  roomOnly: z.object({ room: roomCodeSchema }).strict(),
  playerMove: z.object({ room: roomCodeSchema, from: squareSchema, to: squareSchema, promotion: z.enum(['q', 'r', 'b', 'n']).nullable().optional() }).strict(),
  chat: z.object({ room: roomCodeSchema, message: z.string().trim().min(1).max(200) }).strict(),
  resign: z.object({ room: roomCodeSchema, pgn: pgnSchema }).strict(),
  gameFinished: z.object({
    room: roomCodeSchema,
    result: z.enum(['white_win', 'black_win', 'draw', 'abandoned']),
    winner: z.enum([COLOR.WHITE, COLOR.BLACK]).nullable().optional().default(null),
    pgn: pgnSchema,
  }).strict(),
  playerOnline: z.object({ username: z.string().max(20).optional(), elo: z.number().int().min(100).max(4000).optional(), country: z.string().max(2).optional() }).strict().default({}),
  searchUser: z.object({ username: z.string().trim().min(2).max(20) }).strict(),
  challengeSend: z.object({ targetUsername: z.string().trim().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/) }).strict(),
  challengeSocket: z.object({ challengerSocketId: z.string().min(1).max(120) }).strict(),
};

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
    moveCount: 0,
    lastMove: null,
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

function createGameSnapshot(game) {
  if (!game) return null;
  return {
    board: cloneBoard(game.board),
    turn: game.turn || COLOR.WHITE,
    castlingRights: game.castlingRights || { w: { kingside: true, queenside: true }, b: { kingside: true, queenside: true } },
    enPassantTarget: game.enPassantTarget || null,
    halfMoveClock: game.halfMoveClock || 0,
    moveCount: game.moveCount || 0,
    lastMove: game.lastMove || null,
  };
}

function restoreGameFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.board) || snapshot.board.length !== 8) return createGameState();
  return {
    board: cloneBoard(snapshot.board),
    turn: snapshot.turn === COLOR.BLACK ? COLOR.BLACK : COLOR.WHITE,
    castlingRights: snapshot.castlingRights || { w: { kingside: true, queenside: true }, b: { kingside: true, queenside: true } },
    enPassantTarget: snapshot.enPassantTarget || null,
    halfMoveClock: snapshot.halfMoveClock || 0,
    moveCount: snapshot.moveCount || 0,
    lastMove: snapshot.lastMove || null,
  };
}

function roomPlayerInfo(player) {
  if (!player) return null;
  return {
    userId: player.userId || null,
    name: player.name || 'Jugador',
    country: player.country || 'DO',
    avatar: player.avatar || 0,
    avatarImage: player.avatarImage || '',
    elo: player.elo || 1200,
  };
}

function sameId(a, b) {
  return !!a && !!b && String(a) === String(b);
}

function canUseRoomColor(room, color, userId) {
  if (color !== COLOR.WHITE && color !== COLOR.BLACK) return false;
  const info = room?.playerInfo?.[color];
  return !!info?.userId && sameId(info.userId, userId);
}

function isAuthorizedRoomSocket(room, socket, code) {
  if (!room || !socket?.data?.userId || !socket.rooms.has(code)) return false;
  if (!canUseRoomColor(room, socket.data.color, socket.data.userId)) return false;
  const assignedSocket = socket.data.color === COLOR.WHITE ? room.white : room.black;
  return assignedSocket === socket.id;
}

function emitMoveRejected(socket, room, message) {
  socket.emit('move-rejected', {
    message,
    game: room?.game ? createGameSnapshot(room.game) : null,
    clockW: room?.clockW || DEFAULT_TIME_MS,
    clockB: room?.clockB || DEFAULT_TIME_MS,
  });
}

async function getOrRestoreRoom(roomCode) {
  const code = (roomCode || '').toUpperCase().trim();
  if (!code) return null;
  const existing = rooms.get(code);
  if (existing) return existing;

  const saved = await Room.findOne({ roomCode: code, status: { $in: ['waiting', 'playing'] } }).lean().catch(() => null);
  if (!saved) return null;

  const room = {
    white: null,
    black: null,
    currentTurn: saved.turn || 'w',
    status: saved.status || 'playing',
    rematchReady: new Set(),
    timer: null,
    tokens: { w: null, b: null },
    playerInfo: {
      w: roomPlayerInfo(saved.players?.white),
      b: roomPlayerInfo(saved.players?.black),
    },
    matchId: saved.match || null,
    game: restoreGameFromSnapshot(saved.gameState),
    clockW: saved.clockW || DEFAULT_TIME_MS,
    clockB: saved.clockB || DEFAULT_TIME_MS,
    clockInterval: null,
  };
  room.currentTurn = room.game.turn || room.currentTurn;
  rooms.set(code, room);
  return room;
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

function playerHasLegalMove(game, color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (game.board[row][col]?.color === color && getLegalMovesForSquare(game.board, row, col, game).length) {
        return true;
      }
    }
  }
  return false;
}

function getServerGameConclusion(game) {
  if (!game) return null;
  const turn = game.turn;
  const canMove = playerHasLegalMove(game, turn);
  const inCheck = isInCheck(game.board, turn);
  if (inCheck && !canMove) {
    const winner = enemy(turn);
    return { result: winner === COLOR.WHITE ? 'white_win' : 'black_win', winner, reason: 'checkmate' };
  }
  if (!inCheck && !canMove) return { result: 'draw', winner: null, reason: 'stalemate' };
  if ((game.halfMoveClock || 0) >= 100) return { result: 'draw', winner: null, reason: 'fifty_move' };
  return null;
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
  game.moveCount = (game.moveCount || 0) + 1;
  game.lastMove = {
    from: { row: from.row, col: from.col },
    to: { row: to.row, col: to.col },
  };
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

    if (result === 'white_win') {
      wUser.stats.wins++;
      bUser.stats.losses++;
      wUser.stats.streak = Number(wUser.stats.streak || 0) + 1;
      bUser.stats.streak = 0;
    } else if (result === 'black_win') {
      bUser.stats.wins++;
      wUser.stats.losses++;
      bUser.stats.streak = Number(bUser.stats.streak || 0) + 1;
      wUser.stats.streak = 0;
    } else {
      wUser.stats.draws++;
      bUser.stats.draws++;
      wUser.stats.streak = 0;
      bUser.stats.streak = 0;
    }

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

    const statsSnapshot = (user) => ({
      wins: Number(user.stats?.wins || 0),
      losses: Number(user.stats?.losses || 0),
      draws: Number(user.stats?.draws || 0),
      streak: Number(user.stats?.streak || 0),
    });

    io.to(code).emit('elo-update', {
      w: { newElo: wUser.elo, change: wUser.elo - wBefore, stats: statsSnapshot(wUser) },
      b: { newElo: bUser.elo, change: bUser.elo - bBefore, stats: statsSnapshot(bUser) },
    });
    console.log(`[ELO] ${wUser.username}: ${wBefore}→${wUser.elo} | ${bUser.username}: ${bBefore}→${bUser.elo}`);
  } catch (err) {
    console.warn('[ELO] Error:', err.message);
  }
}

// ── Socket JWT middleware ──────────────────────────────────────────
io.use(async (socket, next) => {
  const token = socketToken(socket);
  if (!token) return next(new Error('Debes iniciar sesion.'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id).select('+tokenVersion username country avatar avatarImage elo isActive').lean();
    if (!user?.isActive || Number(decoded.v || 0) !== Number(user.tokenVersion || 0)) {
      return next(new Error('Sesion invalida.'));
    }
    socket.data.userId = user._id;
    socket.data.user = {
      id: user._id,
      username: user.username,
      country: user.country,
      avatar: user.avatar,
      avatarImage: user.avatarImage,
      elo: user.elo,
    };
    socket.data.playerName = user.username;
  } catch (_) {
    return next(new Error('Sesion invalida.'));
  }
  next();
});

// ================================================================
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id} ${socket.data.userId ? '(auth)' : '(anon)'}`);
  let eventWindowStartedAt = Date.now();
  let eventCount = 0;

  socket.use((packet, next) => {
    const now = Date.now();
    if (now - eventWindowStartedAt >= 10_000) {
      eventWindowStartedAt = now;
      eventCount = 0;
    }
    eventCount += 1;
    if (eventCount > 100) {
      socket.disconnect(true);
      return;
    }
    if (packet.length < 2 || packet[1] === null || typeof packet[1] !== 'object' || Array.isArray(packet[1])) {
      packet[1] = {};
    }
    next();
  });

  const rawSocketOn = socket.on.bind(socket);
  socket.on = (eventName, handler) => rawSocketOn(eventName, async (...args) => {
    try {
      await handler(...args);
    } catch (err) {
      console.warn(`[Socket] Handler ${eventName} fallo:`, err.message);
      if (eventName === 'player-move') socket.emit('move-rejected', { message: 'Solicitud invalida.' });
      else if (eventName.startsWith('challenge')) socket.emit('challenge-error', 'Solicitud invalida.');
      else socket.emit('room-error', 'Solicitud invalida.');
    }
  });

  function parseSocketPayload(schema, payload, errorEvent = 'room-error') {
    const result = schema.safeParse(payload ?? {});
    if (result.success) return result.data;
    if (errorEvent === 'move-rejected') socket.emit(errorEvent, { message: 'Solicitud invalida.' });
    else if (errorEvent === 'search-user-result') socket.emit(errorEvent, { error: 'Solicitud invalida.' });
    else socket.emit(errorEvent, 'Solicitud invalida.');
    return null;
  }

  async function consumeSocketLimit(name, errorEvent = 'room-error') {
    const limiter = socketLimiters[name];
    if (!limiter) return true;
    try {
      await limiter.consume(`${socket.data.userId || 'anon'}:${socket.id}`);
      return true;
    } catch (_) {
      const message = 'Demasiadas acciones. Espera un momento.';
      socket.emit(errorEvent, name === 'playerMove' ? { message } : message);
      console.warn(`[RATE] ${name} limitado socket=${socket.id} user=${socket.data.userId || 'anon'}`);
      return false;
    }
  }

  function requireSocketAuth(message = 'Debes iniciar sesión para jugar.') {
    if (socket.data.userId) return true;
    socket.emit('auth-error', message);
    socket.emit('room-error', message);
    socket.emit('challenge-error', message);
    return false;
  }

  async function getPlayerInfo(playerName, fallbackCountry = 'DO') {
    if (socket.data.user) {
      const user = socket.data.user;
      return { userId: user.id, name: user.username, country: user.country, avatar: user.avatar, avatarImage: user.avatarImage, elo: user.elo };
    }
    return { userId: null, name: playerName || 'Jugador', country: fallbackCountry, avatar: 0, avatarImage: '', elo: 1200 };
  }

  async function createMatchBetween(wSocket, wInfo, bSocket, bInfo, code) {
    rooms.set(code, {
      white: wSocket.id, black: bSocket.id,
      currentTurn: 'w', rematchReady: new Set(), drawOfferBy: null,
      timer: null, status: 'playing', playerInfo: { w: wInfo, b: bInfo }, matchId: null,
      tokens: { w: createRoomToken(), b: createRoomToken() },
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
        'players.white.socketId': wSocket.id, 'players.white.userId': wInfo.userId, 'players.white.name': wInfo.name, 'players.white.country': wInfo.country, 'players.white.avatar': wInfo.avatar, 'players.white.avatarImage': wInfo.avatarImage || '',
        'players.black.socketId': bSocket.id, 'players.black.userId': bInfo.userId, 'players.black.name': bInfo.name, 'players.black.country': bInfo.country, 'players.black.avatar': bInfo.avatar, 'players.black.avatarImage': bInfo.avatarImage || '',
        match: match?._id || null, fen: 'startpos', turn: 'w', gameState: createGameSnapshot(room.game),
        clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, status: 'playing', lastActivityAt: new Date(),
      }},
      { upsert: true, new: true }
    ).catch(() => {});

    wSocket.join(code); wSocket.data.roomCode = code; wSocket.data.color = 'w'; wSocket.data.playerName = wInfo.name;
    bSocket.join(code); bSocket.data.roomCode = code; bSocket.data.color = 'b'; bSocket.data.playerName = bInfo.name;
    if (onlinePlayers.has(wSocket.id)) onlinePlayers.get(wSocket.id).inGame = true;
    if (onlinePlayers.has(bSocket.id)) onlinePlayers.get(bSocket.id).inGame = true;
    broadcastOnlinePlayers();

    wSocket.emit('game-start', { code, color: 'w', roomToken: room.tokens.w, playerInfo: { w: wInfo, b: bInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    bSocket.emit('game-start', { code, color: 'b', roomToken: room.tokens.b, playerInfo: { w: wInfo, b: bInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    startClock(code);

    console.log(`[MM] Partida creada: ${wInfo.name} (w) vs ${bInfo.name} (b) — sala ${code}`);
  }

  // ── MATCHMAKING: unirse a la cola ─────────────────────────────
  socket.on('quick-match', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.quickMatch, payload);
    if (!data) return;
    const { playerName = 'Jugador', country = 'DO' } = data;
    if (!requireSocketAuth()) return;
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
  socket.on('create-room', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.createRoom, payload);
    if (!data) return;
    if (!(await consumeSocketLimit('createRoom'))) return;
    const { playerName = 'Jugador 1', country = 'DO' } = data;
    if (!requireSocketAuth()) return;
    let code;
    do { code = generateCode(); } while (rooms.has(code));

    const pInfo = await getPlayerInfo(playerName, country);

    rooms.set(code, {
      white: socket.id, black: null,
      currentTurn: 'w', rematchReady: new Set(), drawOfferBy: null,
      timer: null, status: 'waiting', playerInfo: { w: pInfo, b: null }, matchId: null,
      tokens: { w: createRoomToken(), b: null },
      game: createGameState(),
      clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, clockInterval: null,
    });

    socket.join(code);
    socket.data.roomCode   = code;
    socket.data.color      = 'w';
    socket.data.playerName = pInfo.name;
    if (onlinePlayers.has(socket.id)) {
      onlinePlayers.get(socket.id).inGame = true;
      broadcastOnlinePlayers();
    }

    socket.emit('room-created', { code, color: 'w', roomToken: rooms.get(code).tokens.w, playerInfo: pInfo });

    await Room.findOneAndUpdate(
      { roomCode: code },
      { $set: {
        roomCode: code,
        'players.white.socketId': socket.id, 'players.white.userId': pInfo.userId,
        'players.white.name': pInfo.name,    'players.white.country': pInfo.country, 'players.white.avatar': pInfo.avatar, 'players.white.avatarImage': pInfo.avatarImage || '',
        'players.black.socketId': null, 'players.black.name': '',
        fen: 'startpos', turn: 'w', gameState: createGameSnapshot(rooms.get(code).game),
        clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, status: 'waiting', lastActivityAt: new Date(),
      }},
      { upsert: true, new: true }
    ).catch((err) => console.warn('[DB] No se pudo guardar sala:', err.message));

    console.log(`[R] Sala ${code} creada por "${pInfo.name}" (${pInfo.country})`);
  });

  // ── Unirse a sala ─────────────────────────────────────────────
  socket.on('join-room', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.joinRoom, payload);
    if (!data) return;
    if (!(await consumeSocketLimit('joinRoom'))) return;
    const { code, playerName = 'Jugador 2', country = 'DO' } = data;
    if (!requireSocketAuth()) return;
    const cleanCode = code;
    const room      = rooms.get(cleanCode);

    if (!room)                    { socket.emit('room-error', 'Sala no encontrada.'); return; }
    if (room.white === socket.id) { socket.emit('room-error', 'No puedes unirte a tu propia sala.'); return; }
    if (room.black)               { socket.emit('room-error', 'La sala ya está llena.'); return; }

    const pInfo = await getPlayerInfo(playerName, country);
    if (sameId(room.playerInfo?.w?.userId, pInfo.userId)) {
      socket.emit('room-error', 'No puedes unirte a tu propia sala.');
      return;
    }
    cancelTimer(room);
    room.black        = socket.id;
    room.playerInfo.b = pInfo;
    room.status       = 'playing';
    room.tokens = room.tokens || { w: null, b: null };
    room.tokens.b = createRoomToken();

    const wInfo = room.playerInfo.w;
    const match = await Match.create({
      whitePlayer: playerSnapshot(wInfo),
      blackPlayer: playerSnapshot(pInfo),
      roomCode: cleanCode, result: 'in_progress', startedAt: new Date(),
    }).catch((err) => { console.warn('[DB] No se pudo crear match:', err.message); return null; });

    if (match) room.matchId = match._id;

    await Room.updateOne({ roomCode: cleanCode }, { $set: {
      'players.black.socketId': socket.id, 'players.black.userId': pInfo.userId,
      'players.black.name': pInfo.name,    'players.black.country': pInfo.country, 'players.black.avatar': pInfo.avatar, 'players.black.avatarImage': pInfo.avatarImage || '',
      match: match?._id || null, turn: room.currentTurn, gameState: createGameSnapshot(room.game),
      clockW: room.clockW || DEFAULT_TIME_MS, clockB: room.clockB || DEFAULT_TIME_MS, status: 'playing', lastActivityAt: new Date(),
    }}).catch((err) => console.warn('[DB] No se pudo actualizar sala:', err.message));

    socket.join(cleanCode);
    socket.data.roomCode   = cleanCode;
    socket.data.color      = 'b';
    socket.data.playerName = pInfo.name;
    if (onlinePlayers.has(socket.id)) onlinePlayers.get(socket.id).inGame = true;
    if (onlinePlayers.has(room.white)) onlinePlayers.get(room.white).inGame = true;
    broadcastOnlinePlayers();

    socket.emit('room-joined', { code: cleanCode, color: 'b', roomToken: room.tokens.b, playerInfo: pInfo });
    io.to(room.white).emit('game-start', { code: cleanCode, color: 'w', roomToken: room.tokens.w, playerInfo: { w: wInfo, b: pInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    socket.emit('game-start',            { code: cleanCode, color: 'b', roomToken: room.tokens.b, playerInfo: { w: wInfo, b: pInfo }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    startClock(cleanCode);

    console.log(`[R] Sala ${cleanCode} — ${wInfo.name} vs ${pInfo.name}`);
  });

  // ── Reconexión ────────────────────────────────────────────────
  socket.on('rejoin', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.rejoin, payload, 'rejoin-failed');
    if (!data) return;
    if (!requireSocketAuth()) return;
    const { roomCode, color, token } = data;
    const room = await getOrRestoreRoom(roomCode);
    const rejoinFailed = (reason) => {
      console.warn(`[SECURITY] Rejoin rejected socket=${socket.id} user=${socket.data.userId || 'anon'} room=${roomCode} reason=${reason}`);
      socket.emit('rejoin-failed', 'No se pudo restaurar la partida.');
    };
    if (!room) { rejoinFailed('room_unavailable'); return; }
    const cleanRoomCode = roomCode;
    const requestedColor = color;
    if (!room.tokens?.[requestedColor] || room.tokens[requestedColor] !== token) {
      rejoinFailed('bad_room_token');
      return;
    }
    const assignedColor = requestedColor;
    if (!canUseRoomColor(room, assignedColor, socket.data.userId)) {
      rejoinFailed('wrong_account');
      return;
    }

    cancelTimer(room);
    socket.join(cleanRoomCode);
    socket.data.roomCode   = cleanRoomCode;
    socket.data.color      = assignedColor;
    socket.data.playerName = socket.data.user?.username || '';

    if (assignedColor === 'w') room.white = socket.id;
    else                       room.black = socket.id;

    await Room.updateOne({ roomCode: cleanRoomCode }, { $set: {
      [`players.${assignedColor === 'w' ? 'white' : 'black'}.socketId`]: socket.id,
      gameState: createGameSnapshot(room.game),
      clockW: room.clockW || DEFAULT_TIME_MS,
      clockB: room.clockB || DEFAULT_TIME_MS,
      lastActivityAt: new Date(),
    }}).catch(() => {});

    socket.emit('rejoin-ok', {
      color: assignedColor,
      playerInfo: room.playerInfo,
      currentTurn: room.game?.turn || room.currentTurn,
      clockW: room.clockW || DEFAULT_TIME_MS,
      clockB: room.clockB || DEFAULT_TIME_MS,
      roomToken: room.tokens[assignedColor],
      game: createGameSnapshot(room.game),
    });
    socket.to(cleanRoomCode).emit('opponent-reconnected', { playerName: socket.data.playerName });
    // Si ambos jugadores están en sala, reanudar reloj
if (room.white && room.black && !room.clockInterval) {
  startClock(cleanRoomCode);
}
    console.log(`[R] ${assignedColor.toUpperCase()} reconectado a sala ${cleanRoomCode}`);
  });

  // ── Movida ────────────────────────────────────────────────────
  socket.on('player-move', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.playerMove, payload, 'move-rejected');
    if (!data) return;
    if (!(await consumeSocketLimit('playerMove', 'move-rejected'))) return;
    const { room: code, from, to, promotion } = data;
    if (!requireSocketAuth()) return;
    const room = rooms.get(code);
    if (!room) { socket.emit('move-rejected', { message: 'La sala ya no existe.' }); return; }

    const playerColor = socket.data.color;
    const roomSockets = [...(io.sockets.adapter.rooms.get(code) || [])];
    console.log('[MOVE:SERVER:IN]', {
      socketId: socket.id, room: code, socketRoom: socket.data.roomCode,
      color: playerColor, turn: room.game?.turn, from, to, promotion,
      joinedRooms: [...socket.rooms], roomWhite: room.white, roomBlack: room.black,
      roomSockets,
    });

    if (!room.game) {
      emitMoveRejected(socket, room, 'Estado de sala inválido.'); return;
    }
    if (room.status && room.status !== 'playing') {
      emitMoveRejected(socket, room, 'La partida ya no está activa.'); return;
    }
    if (!socket.rooms.has(code)) {
      emitMoveRejected(socket, room, 'Socket fuera de la sala.'); return;
    }
    if (!canUseRoomColor(room, playerColor, socket.data.userId)) {
      emitMoveRejected(socket, room, 'No puedes mover piezas de ese color.'); return;
    }
    const assignedSocket = playerColor === COLOR.WHITE ? room.white : room.black;
    if (assignedSocket !== socket.id) {
      emitMoveRejected(socket, room, 'Este dispositivo no controla ese color.'); return;
    }

    let validation;
    try {
      validation = validateAndApplyMove(room.game, playerColor, from, to, promotion);
    } catch (err) {
      emitMoveRejected(socket, room, 'Error validando movimiento.'); return;
    }
    if (!validation.ok) {
      emitMoveRejected(socket, room, validation.message); return;
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
    Room.updateOne({ roomCode: code }, { $set: {
      turn: room.currentTurn,
      gameState: createGameSnapshot(room.game),
      clockW: room.clockW || DEFAULT_TIME_MS,
      clockB: room.clockB || DEFAULT_TIME_MS,
      lastActivityAt: new Date(),
    } }).catch(() => {});
    await finishRoomByServerConclusion(room, code, 'move');
  });

  // ── Chat ──────────────────────────────────────────────────────
  socket.on('chat-message', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.chat, payload);
    if (!data) return;
    const { room: code, message } = data;
    const room = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code)) return;
    const clean = String(message).trim().slice(0, 200);
    if (!clean) return;
    io.to(code).emit('chat-message', {
      from: socket.data.playerName || 'Anónimo',
      color: socket.data.color,
      message: clean,
      timestamp: Date.now(),
    });
  });

  // ── Abandonar ─────────────────────────────────────────────────
  socket.on('player-resign', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.resign, payload);
    if (!data) return;
    const { room: code, pgn = '' } = data;
    const room   = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code) || room.status !== 'playing') return;
    stopClock(room);
    room.status = 'finished';
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
  socket.on('game-finished', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.gameFinished, payload);
    if (!data) return;
    const { room: code, result, winner = null, pgn = '' } = data;
    const room = rooms.get(code);
    if (!room || !room.matchId) return;
    if (!isAuthorizedRoomSocket(room, socket, code) || room.status !== 'playing') return;

    const validResults = new Set(['white_win', 'black_win', 'draw', 'abandoned']);
    const validWinners = new Set(['w', 'b', null]);
    if (!validResults.has(result) || !validWinners.has(winner)) return;
    const conclusion = getServerGameConclusion(room.game);
    if (!conclusion || conclusion.result !== result || conclusion.winner !== winner) {
      emitMoveRejected(socket, room, 'El servidor todavía no reconoce el final de la partida.');
      return;
    }
    const closed = await finishRoomByServerConclusion(room, code, 'client');
    if (closed && pgn) {
      await Match.updateOne({ _id: room.matchId }, { $set: { pgn } }).catch(() => {});
    }
  });

  // ── Revancha ──────────────────────────────────────────────────
  socket.on('rematch-request', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code) || room.status !== 'finished') return;
    room.rematchReady.add(socket.id);
    socket.to(code).emit('rematch-requested', { playerName: socket.data.playerName });
  });

  socket.on('rematch-accept', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code) || room.status !== 'finished') return;
    room.rematchReady.add(socket.id);
    if (room.rematchReady.size >= 2) {
      stopClock(room);
      room.currentTurn  = 'w';
      room.status       = 'playing';
      room.rematchReady = new Set();
      room.drawOfferBy  = null;
      room.game = createGameState();
      room.clockW = DEFAULT_TIME_MS;
      room.clockB = DEFAULT_TIME_MS;
      room.tokens = { w: createRoomToken(), b: createRoomToken() };
      const wInfo = room.playerInfo.w;
      const bInfo = room.playerInfo.b;
      const match = await Match.create({
        whitePlayer: wInfo ? playerSnapshot(wInfo) : { name: 'White' },
        blackPlayer: bInfo ? playerSnapshot(bInfo) : { name: 'Black' },
        roomCode: code, result: 'in_progress', startedAt: new Date(),
      }).catch(() => null);
      if (match) room.matchId = match._id;
      await Room.updateOne({ roomCode: code }, { $set: {
        match: match?._id || room.matchId || null,
        turn: 'w',
        gameState: createGameSnapshot(room.game),
        clockW: DEFAULT_TIME_MS,
        clockB: DEFAULT_TIME_MS,
        status: 'playing',
        lastActivityAt: new Date(),
      }}).catch(() => {});
      if (room.white) io.to(room.white).emit('rematch-start', { roomToken: room.tokens.w, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
      if (room.black) io.to(room.black).emit('rematch-start', { roomToken: room.tokens.b, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
      startClock(code);
      console.log(`[R] Revancha en sala ${code}`);
    }
  });

  socket.on('rematch-decline', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code)) return;
    room.rematchReady = new Set();
    socket.to(code).emit('rematch-declined');
  });

  socket.on('draw-offer', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    if (!isAuthorizedRoomSocket(room, socket, code)) return;
    room.drawOfferBy = socket.id;
    socket.to(code).emit('draw-offered', { playerName: socket.data.playerName });
  });

  socket.on('draw-decline', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!isAuthorizedRoomSocket(room, socket, code)) return;
    if (!room.drawOfferBy || room.drawOfferBy === socket.id) return;
    room.drawOfferBy = null;
    socket.to(code).emit('draw-declined', { playerName: socket.data.playerName });
  });

  socket.on('draw-accept', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.roomOnly, payload);
    if (!data) return;
    const { room: code } = data;
    const room = rooms.get(code);
    if (!room || room.status !== 'playing' || !room.drawOfferBy) return;
    if (!isAuthorizedRoomSocket(room, socket, code)) return;
    if (room.drawOfferBy === socket.id) return;
    stopClock(room);
    room.status = 'finished';
    room.drawOfferBy = null;
    const closed = await finishMatch(room.matchId, 'draw', null);
    if (closed) await applyEloForRoom(room, 'draw', code);
    await Room.updateOne({ roomCode: code }, { $set: { status: 'finished', lastActivityAt: new Date() } }).catch(() => {});
    io.to(code).emit('draw-accepted', { playerName: socket.data.playerName });
    console.log(`[G] Partida ${code} finalizada: draw por acuerdo`);
  });

  socket.on('player-online', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.playerOnline, payload);
    if (!data) return;
    const { username, elo = 1200, country = 'DO' } = data;
    if (!requireSocketAuth()) return;
    const info = await getPlayerInfo(username, country);
    onlinePlayers.set(socket.id, {
      username: info.name,
      country: info.country,
      avatar: info.avatar || 0,
      avatarImage: info.avatarImage || '',
      elo: info.elo || elo || 1200,
      inGame: !!socket.data.roomCode,
    });
    broadcastOnlinePlayers();
  });

  // ── Buscar usuario online ─────────────────────────────────────
  socket.on('search-user', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.searchUser, payload, 'search-user-result');
    if (!data) return;
    const { username } = data;
    if (!requireSocketAuth()) return;
    try {
      const user = await User.findOne({
        username: { $regex: username.trim(), $options: 'i' }
      }).select('username country avatar avatarImage elo stats').lean();

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
  socket.on('challenge-send', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSend, payload, 'challenge-error');
    if (!data) return;
    if (!(await consumeSocketLimit('challengeSend', 'challenge-error'))) return;
    const { targetUsername } = data;
    if (!requireSocketAuth('Debes iniciar sesión para desafiar.')) return;
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(cleanTarget)) {
      socket.emit('challenge-error', 'Jugador invalido.');
      return;
    }

    let targetSocket = null;
    for (const [, s] of io.sockets.sockets) {
      const tUser = await User.findById(s.data.userId).select('username').lean().catch(() => null);
      if (tUser && tUser.username.toLowerCase() === cleanTarget) {
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

    const challenger = await User.findById(socket.data.userId).select('username country avatar avatarImage elo').lean();
    if (!challenger) {
      socket.emit('challenge-error', 'Tu sesion ya no es valida.');
      return;
    }
    if (!pendingChallenges.has(targetSocket.id)) pendingChallenges.set(targetSocket.id, new Set());
    pendingChallenges.get(targetSocket.id).add(socket.id);

    targetSocket.emit('challenge-received', {
      from: { username: challenger.username, country: challenger.country, avatar: challenger.avatar, avatarImage: challenger.avatarImage, elo: challenger.elo },
      socketId: socket.id,
    });

    socket.emit('challenge-sent', { to: targetUsername });
    console.log(`[C] ${challenger.username} desafió a ${targetUsername}`);
  });

  // ── Aceptar desafío ───────────────────────────────────────────
  socket.on('challenge-accept', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSocket, payload, 'challenge-error');
    if (!data) return;
    const { challengerSocketId } = data;
    if (!requireSocketAuth()) return;
    const pending = pendingChallenges.get(socket.id);
    if (!pending?.has(challengerSocketId)) {
      socket.emit('challenge-error', 'Este desafio ya no es valido.');
      return;
    }
    pending.delete(challengerSocketId);
    if (!pending.size) pendingChallenges.delete(socket.id);
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (!challengerSocket || !challengerSocket.connected) {
      socket.emit('challenge-error', 'El rival ya no está disponible.');
      return;
    }
    if (!challengerSocket.data.userId) {
      socket.emit('challenge-error', 'El rival perdió la sesión.');
      return;
    }

    const pInfo = await getPlayerInfo();
    const cInfo = await (async () => {
      if (challengerSocket.data.userId) {
        const u = await User.findById(challengerSocket.data.userId).select('username country avatar avatarImage elo').lean();
        if (u) return { userId: u._id, name: u.username, country: u.country, avatar: u.avatar, avatarImage: u.avatarImage, elo: u.elo };
      }
      return { userId: null, name: challengerSocket.data.playerName || 'Jugador', country: 'DO', avatar: 0, avatarImage: '', elo: 1200 };
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
  socket.on('challenge-decline', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSocket, payload, 'challenge-error');
    if (!data) return;
    const { challengerSocketId } = data;
    const pending = pendingChallenges.get(socket.id);
    if (!pending?.has(challengerSocketId)) return;
    pending.delete(challengerSocketId);
    if (!pending.size) pendingChallenges.delete(socket.id);
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (challengerSocket) {
      challengerSocket.emit('challenge-declined', { by: socket.data.playerName || 'El jugador' });
    }
  });

  // ── DAMAS (checkers) — namespace de eventos y estado totalmente
  //    separado del ajedrez (damasRooms, nunca `rooms`). Ningun
  //    handler de arriba se toca ni se modifica para esto.
  socket.on('damas:create-room', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.createRoom, payload, 'damas:room-error');
    if (!data) return;
    if (!(await consumeSocketLimit('damasCreateRoom', 'damas:room-error'))) return;
    if (!requireSocketAuth()) return;
    const { playerName = 'Jugador 1', country = 'DO' } = data;

    let code;
    do { code = generateCode(); } while (rooms.has(code) || damasRooms.has(code));

    const pInfo = await getPlayerInfo(playerName, country);

    damasRooms.set(code, {
      white: socket.id, black: null,
      board: OzamaCheckers.createInitialBoard(),
      turn: OzamaCheckers.COLOR.WHITE,
      status: 'waiting',
      playerInfo: { w: pInfo, b: null },
      createdAt: Date.now(),
    });

    socket.join(code);
    socket.data.damasRoomCode = code;
    socket.data.damasColor = 'w';

    socket.emit('damas:room-created', { code, color: 'w', playerInfo: pInfo });
    console.log(`[DAMAS] Sala ${code} creada por "${pInfo.name}"`);
  });

  socket.on('damas:join-room', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.joinRoom, payload, 'damas:room-error');
    if (!data) return;
    if (!(await consumeSocketLimit('damasJoinRoom', 'damas:room-error'))) return;
    if (!requireSocketAuth()) return;
    const { code, playerName = 'Jugador 2', country = 'DO' } = data;

    const room = damasRooms.get(code);
    if (!room) { socket.emit('damas:room-error', 'La sala no existe.'); return; }
    if (room.black) { socket.emit('damas:room-error', 'La sala ya esta llena.'); return; }
    if (room.white === socket.id) { socket.emit('damas:room-error', 'No puedes unirte a tu propia sala.'); return; }

    const pInfo = await getPlayerInfo(playerName, country);
    room.black = socket.id;
    room.playerInfo.b = pInfo;
    room.status = 'playing';

    socket.join(code);
    socket.data.damasRoomCode = code;
    socket.data.damasColor = 'b';

    const whiteSocket = io.sockets.sockets.get(room.white);
    const startPayload = { code, board: room.board, turn: room.turn, playerInfo: room.playerInfo };
    whiteSocket?.emit('damas:game-start', { ...startPayload, color: 'w' });
    socket.emit('damas:game-start', { ...startPayload, color: 'b' });
    console.log(`[DAMAS] "${pInfo.name}" se unio a la sala ${code}`);
  });

  socket.on('damas:move', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.move, payload, 'damas:move-rejected');
    if (!data) return;
    if (!(await consumeSocketLimit('damasMove', 'damas:move-rejected'))) return;
    if (!requireSocketAuth()) return;
    const { room: code, fromR, fromC, seq } = data;

    const room = damasRooms.get(code);
    if (!room) { socket.emit('damas:move-rejected', { message: 'La sala ya no existe.' }); return; }
    if (room.status !== 'playing') { socket.emit('damas:move-rejected', { message: 'La partida no esta activa.' }); return; }

    const myColor = socket.data.damasColor;
    const assignedSocket = myColor === 'w' ? room.white : room.black;
    if (!myColor || assignedSocket !== socket.id) {
      socket.emit('damas:move-rejected', { message: 'No controlas ese color.' }); return;
    }
    if (room.turn !== myColor) {
      socket.emit('damas:move-rejected', { message: 'No es tu turno.' }); return;
    }

    // Nunca confiar en la secuencia del cliente: debe coincidir
    // exactamente con una jugada que el motor considera legal ahora
    // mismo (respeta captura obligatoria y regla de mayoria).
    const legal = OzamaCheckers.getLegalMovesForSquare(room.board, fromR, fromC);
    const seqJson = JSON.stringify(seq);
    const matched = legal.find((candidate) => JSON.stringify(candidate) === seqJson);
    if (!matched) {
      socket.emit('damas:move-rejected', { message: 'Jugada ilegal.' }); return;
    }

    const result = OzamaCheckers.applyMove(room.board, fromR, fromC, matched);
    room.board = result.board;
    room.turn = OzamaCheckers.otherColor(room.turn);
    const status = OzamaCheckers.checkGameOver(room.board, room.turn);
    if (status.over) room.status = 'finished';

    io.to(code).emit('damas:board-update', {
      board: room.board,
      turn: room.turn,
      lastMove: { fromR, fromC, toR: result.to.r, toC: result.to.c },
      gameOver: status.over ? status : null,
    });
  });

  socket.on('damas:resign', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.roomOnly, payload, 'damas:room-error');
    if (!data) return;
    const { room: code } = data;
    const room = damasRooms.get(code);
    if (!room) return;
    const myColor = socket.data.damasColor;
    if (!myColor || room.status !== 'playing') return;
    room.status = 'finished';
    io.to(code).emit('damas:game-over', { winner: OzamaCheckers.otherColor(myColor), reason: 'resign' });
  });

  socket.on('disconnect', () => {
    const damasCode = socket.data.damasRoomCode;
    const damasRoom = damasCode ? damasRooms.get(damasCode) : null;
    if (damasRoom) {
      if (damasRoom.white === socket.id) damasRoom.white = null;
      if (damasRoom.black === socket.id) damasRoom.black = null;
      if (damasRoom.status === 'playing') {
        damasRoom.status = 'finished';
        socket.to(damasCode).emit('damas:opponent-disconnected');
      }
      if (!damasRoom.white && !damasRoom.black) damasRooms.delete(damasCode);
    }
  });

  // ── Desconexión ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    onlinePlayers.delete(socket.id);
    pendingChallenges.delete(socket.id);
    for (const [targetId, challengers] of pendingChallenges) {
      challengers.delete(socket.id);
      if (!challengers.size) pendingChallenges.delete(targetId);
    }
    broadcastOnlinePlayers();

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
