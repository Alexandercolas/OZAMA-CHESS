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
const DamasMatch      = require('./models/DamasMatch');
const Room            = require('./models/Room');
const User            = require('./models/User');
const Event           = require('./models/Event');
const { generateNextRound } = require('./services/tournament');
const { xpForResult, buildContext, checkNewAchievements } = require('./services/achievements');

const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/user');
const adminRoutes     = require('./routes/admin');
const eventRoutes     = require('./routes/events');
const billingRoutes   = require('./routes/billing');
const matchesRoutes   = require('./routes/matches');
const puzzlesRoutes   = require('./routes/puzzles');
const damasPuzzlesRoutes = require('./routes/damas-puzzles');
const openingsRoutes  = require('./routes/openings');

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
  const onLoginPage = req.path === '/login.html';
  const googleLoginEnabled = onLoginPage
    && Boolean(String(process.env.GOOGLE_WEB_CLIENT_ID || '').trim());
  const recaptchaEnabled = onLoginPage
    && Boolean(String(process.env.RECAPTCHA_SITE_KEY || '').trim());
  const onSettingsPage = req.path === '/settings.html';
  const paypalEnabled = onSettingsPage
    && Boolean(String(process.env.PAYPAL_CLIENT_ID || '').trim());
  const googleScript = googleLoginEnabled ? ' https://accounts.google.com/gsi/client' : '';
  const googleParent = googleLoginEnabled ? ' https://accounts.google.com/gsi/' : '';
  const googleStyle = googleLoginEnabled ? ' https://accounts.google.com/gsi/style' : '';
  const recaptchaScript = recaptchaEnabled ? ' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/' : '';
  const recaptchaFrame = recaptchaEnabled ? ' https://www.google.com/recaptcha/' : '';
  const paypalScript = paypalEnabled ? ' https://www.paypal.com https://www.paypalobjects.com' : '';
  const paypalFrame = paypalEnabled ? ' https://www.paypal.com https://www.sandbox.paypal.com' : '';
  const paypalConnect = paypalEnabled ? ' https://www.paypal.com https://www.sandbox.paypal.com' : '';
  const paypalImg = paypalEnabled ? ' https://www.paypalobjects.com' : '';
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
    `script-src 'self' 'unsafe-inline'${googleScript}${recaptchaScript}${paypalScript}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${googleStyle}`,
    "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: https://flagcdn.com${paypalImg}`,
    "media-src 'self'",
    `frame-src 'self'${googleParent}${recaptchaFrame}${paypalFrame}`,
    `connect-src 'self' ws: wss:${googleParent}${recaptchaFrame}${paypalConnect}`,
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
app.use('/api/billing', billingRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/puzzles', puzzlesRoutes);
app.use('/api/damas-puzzles', damasPuzzlesRoutes);
app.use('/api/openings', openingsRoutes);

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
// Version de Damas de lo mismo -- lista aparte porque son perfiles/ELO
// distintos, y solo tiene sentido para jugadores logueados (invitado
// no tiene un nombre unico contra el cual desafiar a alguien).
const damasOnlinePlayers = new Map();
const damasPendingChallenges = new Map();
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
  rejoin: z.object({ room: roomCodeSchema, color: z.enum(['w', 'b']), token: z.string().length(48) }).strict(),
};

// Grace period antes de dar por perdida una sala de Damas cuando un
// jugador se desconecta (recarga de pagina, WiFi, cambio de app en el
// telefono). Si reconecta con damas:rejoin antes de que esto dispare,
// la partida sigue igual que estaba.
function damasCancelCloseTimer(room) {
  if (room.closeTimer) { clearTimeout(room.closeTimer); room.closeTimer = null; }
}

function damasStartCloseTimer(code) {
  const room = damasRooms.get(code);
  if (!room) return;
  damasCancelCloseTimer(room);
  room.closeTimer = setTimeout(async () => {
    if (room.status === 'playing') {
      const survivorColor = room.white ? 'w' : room.black ? 'b' : null;
      if (survivorColor) {
        room.status = 'finished';
        io.to(code).emit('damas:game-over', { winner: survivorColor, reason: 'opponent-left' });
        await finishDamasGame(room, code, { winner: survivorColor, reason: 'opponent-left' });
      }
    }
    damasRooms.delete(code);
  }, 30_000);
}

// Guarda el resultado final de una partida de Damas (historial + ELO
// propio de Damas, separado del de ajedrez). Solo persiste cuando
// ambos lados son cuentas reales -- una partida de invitado no tiene a
// quien atribuirsela. Abandono (rival se fue / cerro un admin) se
// registra en el historial pero nunca mueve el ELO, igual que el
// ajedrez trata sus partidas 'abandoned'.
async function finishDamasGame(room, code, { winner, reason }) {
  const wInfo = room.playerInfo?.w;
  const bInfo = room.playerInfo?.b;
  if (!wInfo || !bInfo || !wInfo.userId || !bInfo.userId) return;

  const abandoned = reason === 'opponent-left' || reason === 'admin-closed';
  const result = abandoned ? 'abandoned'
    : winner === 'w' ? 'white_win'
    : winner === 'b' ? 'black_win'
    : 'draw';

  try {
    const eloChange = { white: null, black: null };

    if (!abandoned) {
      const [wUser, bUser] = await Promise.all([User.findById(wInfo.userId), User.findById(bInfo.userId)]);
      if (wUser && bUser) {
        const wResult = result === 'white_win' ? 1 : result === 'draw' ? 0.5 : 0;
        const bResult = 1 - wResult;
        const wBefore = wUser.damasElo;
        const bBefore = bUser.damasElo;

        wUser.updateDamasElo(bBefore, wResult);
        bUser.updateDamasElo(wBefore, bResult);

        if (result === 'white_win') {
          wUser.damasStats.wins++; bUser.damasStats.losses++;
          bumpStreak(wUser.damasStats, true);
          bumpStreak(bUser.damasStats, false);
        } else if (result === 'black_win') {
          bUser.damasStats.wins++; wUser.damasStats.losses++;
          bumpStreak(bUser.damasStats, true);
          bumpStreak(wUser.damasStats, false);
        } else {
          wUser.damasStats.draws++; bUser.damasStats.draws++;
          bumpStreak(wUser.damasStats, false);
          bumpStreak(bUser.damasStats, false);
        }

        applyProgressionForMatch({
          wUser, bUser,
          wOutcome: result === 'white_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
          bOutcome: result === 'black_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
          wEloBefore: wBefore, bEloBefore: bBefore,
          moveCount: 0,
          game: 'damas',
          promotions: room.hadPromotion,
        });

        eloChange.white = wUser.damasElo - wBefore;
        eloChange.black = bUser.damasElo - bBefore;

        await Promise.all([
          wUser.save({ validateModifiedOnly: true }),
          bUser.save({ validateModifiedOnly: true }),
        ]);
      }
    }

    await DamasMatch.create({
      roomCode: code,
      whitePlayer: playerSnapshot(wInfo),
      blackPlayer: playerSnapshot(bInfo),
      result,
      winner: winner || null,
      reason,
      eloChange,
      startedAt: room.startedAt || new Date(),
      endedAt: new Date(),
    });

    // Avanza el bracket si esta partida era de un torneo de Damas.
    // Guardia en memoria (no hay un "match en curso" contra el cual
    // hacer compare-and-swap como en ajedrez, ya que el DamasMatch se
    // crea de una sola vez arriba, recien al terminar) -- room es el
    // mismo objeto en memoria para todos los call-sites de esta
    // partida, asi que alcanza para no avanzar el bracket dos veces.
    if (room.tournamentMeta && !room._tournamentAdvanced) {
      room._tournamentAdvanced = true;
      await handleTournamentMatchFinished(room.tournamentMeta, winner, room);
    }
  } catch (err) {
    console.warn('[DAMAS] No se pudo guardar el resultado:', err.message);
  }
}

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
      const closed = await finishMatch(room.matchId, result, winner, '', room, 'timeout');
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
      const closed = await finishMatch(room.matchId, result, winner, '', room, 'abandoned');
      if (closed && winner) await applyEloForRoom(room, result, code);
    }
    await Room.updateOne({ roomCode: code }, { $set: { status: 'closed', lastActivityAt: new Date() } }).catch(() => {});
    rooms.delete(code);
    console.log(`[X] Sala ${code} cerrada por timeout`);
  }, 30_000);
}

// Cuando una sala de torneo termina, avanza el bracket guardado en el
// Event correspondiente. Un empate o abandono NO decide el partido --
// se deja "ready" con roomCode en null para que se rejuegue la
// proxima vez que cualquiera de los dos entre desde la pagina de
// torneos (tournament:join-match arma la sala de nuevo).
// Usa updates atomicos (en vez de leer-modificar-guardar todo el
// documento) a proposito: si un torneo tiene 4+ jugadores, dos
// partidos de la MISMA ronda pueden terminar casi al mismo tiempo, y
// un simple event.save() pisaria el cambio del otro (probado: dos
// .save() concurrentes sobre el mismo Event, uno de los dos se pierde
// en silencio, Mongoose no lo detecta por defecto). El $expr sobre el
// tamano de bracket.rounds funciona como compare-and-swap: si dos
// partidos de la ronda terminan a la vez y ambos ven "ronda completa",
// solo uno de los dos updateOne/findOneAndUpdate de mas abajo
// realmente matchea y empuja la ronda siguiente / corona al campeon.
async function handleTournamentMatchFinished(tournamentMeta, winner, room) {
  try {
    const { eventId, round, matchIndex } = tournamentMeta || {};
    if (!eventId || round === undefined || round === null || matchIndex === undefined || matchIndex === null) return;

    if (!winner) {
      await Event.updateOne({ _id: eventId }, { $set: {
        [`bracket.rounds.${round}.matches.${matchIndex}.status`]: 'ready',
        [`bracket.rounds.${round}.matches.${matchIndex}.roomCode`]: null,
      }});
      return;
    }

    const winnerUserId = winner === 'w' ? room?.playerInfo?.w?.userId : room?.playerInfo?.b?.userId;
    await Event.updateOne({ _id: eventId }, { $set: {
      [`bracket.rounds.${round}.matches.${matchIndex}.winner`]: winnerUserId || null,
      [`bracket.rounds.${round}.matches.${matchIndex}.status`]: 'finished',
    }});

    // Releer el estado real (puede ya incluir el resultado de otro
    // partido de la misma ronda que termino casi en simultaneo).
    const event = await Event.findById(eventId).select('title bracket.rounds').lean();
    const roundMatches = event?.bracket?.rounds?.[round]?.matches || [];
    if (!roundMatches.length) return;
    const allDecided = roundMatches.every((m) => m.status === 'finished' || m.status === 'bye');
    if (!allDecided) return;

    const winners = roundMatches
      .map((m) => ({
        userId: m.winner,
        name: m.winner && String(m.winner) === String(m.player1) ? m.player1Name : m.player2Name,
      }))
      .filter((w) => w.userId);

    const expectedRoundCount = round + 1;
    if (winners.length <= 1) {
      const updated = await Event.findOneAndUpdate(
        { _id: eventId, 'bracket.championId': null, $expr: { $eq: [{ $size: '$bracket.rounds' }, expectedRoundCount] } },
        { $set: { 'bracket.championId': winners[0]?.userId || null, 'bracket.championName': winners[0]?.name || '', status: 'finished' } },
        { new: true }
      ).select('title bracket.championName');
      if (updated) console.log(`[Tournament] ${updated.title} — campeon: ${updated.bracket.championName}`);
    } else {
      const nextRound = generateNextRound(winners);
      const updated = await Event.findOneAndUpdate(
        { _id: eventId, $expr: { $eq: [{ $size: '$bracket.rounds' }, expectedRoundCount] } },
        { $push: { 'bracket.rounds': nextRound } },
        { new: true }
      ).select('title bracket.rounds');
      if (updated) console.log(`[Tournament] ${updated.title} — ronda ${expectedRoundCount + 1} generada.`);
    }
  } catch (err) {
    console.warn('[Tournament] No se pudo avanzar el bracket:', err.message);
  }
}

async function finishMatch(matchId, result, winner = null, pgn = '', room = null, endReason = null) {
  if (!matchId) return false;
  const set = { result, winner, endedAt: new Date() };
  if (pgn) set.pgn = pgn;
  if (endReason) set.endReason = endReason;
  const update = await Match.updateOne({ _id: matchId, result: 'in_progress' }, { $set: set })
    .catch((err) => { console.warn('[DB] No se pudo cerrar match:', err.message); return null; });
  const closed = !!update?.modifiedCount;
  if (closed && room?.tournamentMeta) await handleTournamentMatchFinished(room.tournamentMeta, winner, room);
  return closed;
}

async function finishRoomByServerConclusion(room, code, source = 'server') {
  if (!room || room.status !== 'playing' || !room.matchId) return null;
  const conclusion = getServerGameConclusion(room.game);
  if (!conclusion) return null;

  stopClock(room);
  room.status = 'finished';
  const closed = await finishMatch(room.matchId, conclusion.result, conclusion.winner, '', room, conclusion.reason);
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

// Actualiza racha actual + mejor racha de siempre (Fase 3 del roadmap
// PRO, tarjeta de perfil) -- un solo lugar para ajedrez y Damas, en
// vez de repetir la logica en cada bloque que cierra una partida.
function bumpStreak(statsObj, won) {
  if (!statsObj) return;
  statsObj.streak = won ? Number(statsObj.streak || 0) + 1 : 0;
  if (statsObj.streak > Number(statsObj.bestStreak || 0)) statsObj.bestStreak = statsObj.streak;
}

// XP + logros (Fase 4 del roadmap PRO) para los dos jugadores de una
// partida que recien termino. Se llama DESPUES de actualizar
// stats/streak/elo de cada usuario (buildContext necesita los totales
// ya actualizados) y ANTES de guardarlos -- no agrega un save() extra,
// reusa el que ya iba a pasar para cerrar la partida.
function applyProgressionForMatch({ wUser, bUser, wOutcome, bOutcome, wEloBefore, bEloBefore, moveCount, game, promotions }) {
  for (const [user, outcome, opponentElo, justPromoted] of [
    [wUser, wOutcome, bEloBefore, promotions?.w],
    [bUser, bOutcome, wEloBefore, promotions?.b],
  ]) {
    if (!user) continue;
    user.xp = Number(user.xp || 0) + xpForResult(outcome);
    const ctx = buildContext({ user, game, outcome, opponentElo, moveCount, endedAt: new Date(), justPromoted: !!justPromoted });
    const newKeys = checkNewAchievements(user, ctx);
    if (newKeys.length) {
      user.achievements = [...(user.achievements || []), ...newKeys.map((key) => ({ key, unlockedAt: new Date() }))];
    }
  }
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

function broadcastDamasOnlinePlayers() {
  io.emit('damas:players-online', [...damasOnlinePlayers.values()]);
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
  const activeDamasRooms = [...damasRooms.values()].filter((room) => ['waiting', 'playing'].includes(room.status)).length;
  const authenticatedUsers = new Set(
    [...io.sockets.sockets.values()]
      .map((socket) => socket.data.userId && String(socket.data.userId))
      .filter(Boolean)
  );
  return {
    socketConnections: io.sockets.sockets.size,
    onlineUsers: authenticatedUsers.size,
    activeRooms,
    activeDamasRooms,
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
  if (room.matchId) await finishMatch(room.matchId, 'abandoned', null, '', room);
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

// ── Visibilidad admin de Damas (namespace separado de rooms/ajedrez) ──
function adminDamasRoomSnapshot(code, room) {
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
    turn: room.turn || 'w',
    connected,
    white: player(room.playerInfo?.w, room.white),
    black: player(room.playerInfo?.b, room.black),
  };
}

function adminActiveDamasRooms() {
  return [...damasRooms.entries()]
    .filter(([, room]) => ['waiting', 'playing'].includes(room.status))
    .map(([code, room]) => adminDamasRoomSnapshot(code, room))
    .sort((a, b) => a.code.localeCompare(b.code));
}

async function adminCloseDamasRoom(code, reason) {
  const room = damasRooms.get(code);
  if (!room) return null;
  const snapshot = adminDamasRoomSnapshot(code, room);
  const wasPlaying = room.status === 'playing';

  damasCancelCloseTimer(room);
  room.status = 'closed';

  const socketIds = [...(io.sockets.adapter.rooms.get(code) || [])];
  for (const socketId of socketIds) {
    const roomSocket = io.sockets.sockets.get(socketId);
    if (!roomSocket) continue;
    roomSocket.emit('damas:game-over', { winner: null, reason: 'admin-closed' });
    roomSocket.emit('room-closed', { reason });
    roomSocket.leave(code);
    roomSocket.data.damasRoomCode = null;
    roomSocket.data.damasColor = null;
  }

  if (wasPlaying) await finishDamasGame(room, code, { winner: null, reason: 'admin-closed' });
  damasRooms.delete(code);
  console.warn(`[Admin] Sala de Damas ${code} cerrada manualmente`);
  return snapshot;
}

app.locals.adminRuntime = {
  snapshot: adminRuntimeSnapshot,
  rooms: adminActiveRooms,
  closeRoom: adminCloseRoom,
  disconnectUser: adminDisconnectUser,
  damasRooms: adminActiveDamasRooms,
  closeDamasRoom: adminCloseDamasRoom,
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
  tournamentJoinMatch: z.object({
    eventId: z.string().trim().regex(/^[a-f0-9]{24}$/i),
    round: z.number().int().min(0).max(20),
    matchIndex: z.number().int().min(0).max(255),
  }).strict(),
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

  const saved = await Room.findOne({ roomCode: code, status: { $in: ['waiting', 'playing'] } })
    .select('+tokens.w +tokens.b').lean().catch(() => null);
  if (!saved) return null;

  // El proceso se reinicio (o esta sala nunca vivio en memoria en este
  // proceso) -- el historial de jugadas para la revision en el cliente
  // sale del Match ya guardado en Mongo, no hay otra copia.
  let moves = [];
  if (saved.match) {
    const match = await Match.findById(saved.match).select('moves').lean().catch(() => null);
    if (Array.isArray(match?.moves)) {
      moves = match.moves.map((m) => ({ from: m.from, to: m.to, promotion: m.promotion || null }));
    }
  }

  const room = {
    white: null,
    black: null,
    currentTurn: saved.turn || 'w',
    status: saved.status || 'playing',
    rematchReady: new Set(),
    timer: null,
    tokens: { w: saved.tokens?.w || null, b: saved.tokens?.b || null },
    playerInfo: {
      w: roomPlayerInfo(saved.players?.white),
      b: roomPlayerInfo(saved.players?.black),
    },
    matchId: saved.match || null,
    game: restoreGameFromSnapshot(saved.gameState),
    moves,
    clockW: saved.clockW || DEFAULT_TIME_MS,
    clockB: saved.clockB || DEFAULT_TIME_MS,
    clockInterval: null,
  };
  if (saved.tournamentMeta?.eventId) {
    room.tournamentMeta = {
      eventId: String(saved.tournamentMeta.eventId),
      round: saved.tournamentMeta.round,
      matchIndex: saved.tournamentMeta.matchIndex,
    };
  }
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
      bumpStreak(wUser.stats, true);
      bumpStreak(bUser.stats, false);
    } else if (result === 'black_win') {
      bUser.stats.wins++;
      wUser.stats.losses++;
      bumpStreak(bUser.stats, true);
      bumpStreak(wUser.stats, false);
    } else {
      wUser.stats.draws++;
      bUser.stats.draws++;
      bumpStreak(wUser.stats, false);
      bumpStreak(bUser.stats, false);
    }

    applyProgressionForMatch({
      wUser, bUser,
      wOutcome: result === 'white_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
      bOutcome: result === 'black_win' ? 'win' : result === 'draw' ? 'draw' : 'loss',
      wEloBefore: wBefore, bEloBefore: bBefore,
      moveCount: room.moves?.length || 0,
      game: 'chess',
    });

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
// Sin token: se deja pasar como invitado (socket.data.userId queda sin
// definir). Esto NO afecta al ajedrez -- cada handler de ajedrez ya
// exige requireSocketAuth() por su cuenta, y en la practica nunca se
// llega a abrir el socket sin sesion porque lobby.html/game.html
// redirigen a login.html antes de intentar conectar. Solo Damas
// (damas:create-room / damas:join-room / damas:move) queda accesible
// sin iniciar sesion, a proposito, para permitir jugar como invitado
// en la web. Con token presente pero invalido/expirado, se sigue
// rechazando la conexion igual que antes.
io.use(async (socket, next) => {
  const token = socketToken(socket);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id).select('+tokenVersion username country avatar avatarImage elo damasElo isActive').lean();
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
      damasElo: user.damasElo,
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

  // Variante de consumeSocketLimit para eventos alcanzables sin login
  // (Damas invitado). consumeSocketLimit mezcla socket.id en la llave,
  // asi que un invitado podia reconectar con un socket nuevo para
  // resetear su propio limite; para un usuario logueado esto no
  // importa (userId es estable), pero para 'anon' es un vector real de
  // spam. Aqui, sin sesion, se usa la IP como identidad en su lugar.
  async function consumeDamasLimit(name, errorEvent = 'damas:room-error') {
    const limiter = socketLimiters[name];
    if (!limiter) return true;
    const ip = String(socket.handshake?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || socket.handshake?.address || 'unknown');
    const identity = socket.data.userId ? String(socket.data.userId) : `ip:${ip}`;
    try {
      await limiter.consume(identity);
      return true;
    } catch (_) {
      const message = 'Demasiadas acciones. Espera un momento.';
      socket.emit(errorEvent, name === 'damasMove' ? { message } : message);
      console.warn(`[RATE] ${name} limitado identity=${identity}`);
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

  // Igual que getPlayerInfo, pero por userId en vez de por el socket
  // actual -- hace falta para torneos: al armar una sala de bracket
  // conocemos a los dos jugadores de antemano, pero el rival puede no
  // estar conectado todavia.
  async function getPlayerInfoById(userId, fallbackName) {
    if (userId) {
      const u = await User.findById(userId).select('username country avatar avatarImage elo').lean().catch(() => null);
      if (u) return { userId: u._id, name: u.username, country: u.country, avatar: u.avatar, avatarImage: u.avatarImage, elo: u.elo };
    }
    return { userId: userId || null, name: fallbackName || 'Jugador', country: 'DO', avatar: 0, avatarImage: '', elo: 1200 };
  }

  async function createMatchBetween(wSocket, wInfo, bSocket, bInfo, code) {
    rooms.set(code, {
      white: wSocket.id, black: bSocket.id,
      currentTurn: 'w', rematchReady: new Set(), drawOfferBy: null,
      timer: null, status: 'playing', playerInfo: { w: wInfo, b: bInfo }, matchId: null,
      tokens: { w: createRoomToken(), b: createRoomToken() },
      game: createGameState(), moves: [],
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
        'tokens.w': room.tokens.w, 'tokens.b': room.tokens.b,
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

    // Bloqueo (Fase 10): no emparejar con nadie que yo bloquee ni con
    // nadie que me haya bloqueado a mi. blockedUsers va aparte de
    // pInfo a proposito -- pInfo termina guardado en Match/DamasMatch
    // como snapshot del jugador, y esto no tiene que filtrarse ahi.
    const myBlockedDoc = pInfo.userId
      ? await User.findById(pInfo.userId).select('blockedUsers').lean().catch(() => null)
      : null;
    const myBlocked = (myBlockedDoc?.blockedUsers || []).map(String);

    const rivalIdx = matchQueue.findIndex(e => {
      if (e.socketId === socket.id) return false;
      if (pInfo.userId && e.playerInfo.userId.toString() === pInfo.userId.toString()) return false;
      if (pInfo.userId && myBlocked.includes(e.playerInfo.userId?.toString())) return false;
      if (pInfo.userId && (e.blockedUsers || []).includes(pInfo.userId.toString())) return false;
      const rivalSocket = io.sockets.sockets.get(e.socketId);
      return rivalSocket.connected;
    });

    if (rivalIdx !== -1) {
      const [rival] = matchQueue.splice(rivalIdx, 1);
      const rivalSocket = io.sockets.sockets.get(rival.socketId);

      if (!rivalSocket.connected) {
        matchQueue.push({ socketId: socket.id, playerInfo: pInfo, joinedAt: Date.now(), blockedUsers: myBlocked });
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
      matchQueue.push({ socketId: socket.id, playerInfo: pInfo, joinedAt: Date.now(), blockedUsers: myBlocked });
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
      game: createGameState(), moves: [],
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
        'tokens.w': rooms.get(code).tokens.w,
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
      'tokens.b': room.tokens.b,
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
      moves: room.moves || [],
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
    (room.moves = room.moves || []).push({ from: validation.from, to: validation.to, promotion: validation.promotion || null });
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
      const closed = await finishMatch(room.matchId, result, winner, pgn, room, 'resign');
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
      room.moves = [];
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
        'tokens.w': room.tokens.w, 'tokens.b': room.tokens.b,
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
    const closed = await finishMatch(room.matchId, 'draw', null, '', room, 'draw_agreed');
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
      // Escapar caracteres especiales de regex antes de meterlos en la
      // consulta -- sin esto, un nombre de usuario con metacaracteres
      // (".", "*", "(a+)+", etc.) se interpreta como patron en vez de
      // texto literal: en el mejor caso da resultados raros, en el
      // peor es un vector de ReDoS. Mismo patron que ya usa
      // routes/user.js para busqueda de amigos.
      const safeUsername = username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const user = await User.findOne({
        username: { $regex: safeUsername, $options: 'i' }
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

    // Bloqueo (Fase 10): unidireccional -- si el objetivo bloqueo al
    // que desafia, o al reves, no se deja mandar el desafio. No se le
    // dice a quien bloqueo cual es el motivo exacto para no filtrar
    // quien bloqueo a quien.
    const targetBlocklist = await User.findById(targetSocket.data.userId).select('blockedUsers').lean();
    const challengerBlocklist = await User.findById(socket.data.userId).select('blockedUsers').lean();
    const blocked = (targetBlocklist?.blockedUsers || []).some((id) => String(id) === String(socket.data.userId))
      || (challengerBlocklist?.blockedUsers || []).some((id) => String(id) === String(targetSocket.data.userId));
    if (blocked) {
      socket.emit('challenge-error', 'No podés desafiar a este jugador.');
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

  // ── TORNEOS: entrar a tu partido del bracket ────────────────────
  // A diferencia de create-room/join-room (donde el rival es
  // "quien tenga el codigo"), aca los dos jugadores ya estan fijados
  // de antemano por el bracket -- este evento solo confirma que sos
  // uno de los dos y te arma (o te reconecta a) la sala. El primero
  // de los dos en entrar crea la sala entera con ambos jugadores ya
  // identificados; el segundo simplemente completa su lado.
  socket.on('tournament:join-match', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.tournamentJoinMatch, payload, 'tournament:error');
    if (!data) return;
    if (!requireSocketAuth()) return;
    const { eventId, round, matchIndex } = data;

    const event = await Event.findById(eventId).catch(() => null);
    if (!event || event.type !== 'tournament') { socket.emit('tournament:error', 'Torneo no encontrado.'); return; }
    const match = event.bracket?.rounds?.[round]?.matches?.[matchIndex];
    if (!match) { socket.emit('tournament:error', 'Partido no encontrado.'); return; }

    const userId = String(socket.data.userId);
    const isP1 = match.player1 && String(match.player1) === userId;
    const isP2 = match.player2 && String(match.player2) === userId;
    if (!isP1 && !isP2) { socket.emit('tournament:error', 'No sos parte de este partido.'); return; }
    if (match.status !== 'ready' && match.status !== 'playing') {
      socket.emit('tournament:error', 'Este partido no esta disponible ahora mismo.');
      return;
    }
    const myColor = isP1 ? 'w' : 'b';

    let room = match.roomCode ? rooms.get(match.roomCode) : null;
    if (!room && match.roomCode) room = await getOrRestoreRoom(match.roomCode);

    if (!room) {
      let code;
      do { code = generateCode(); } while (rooms.has(code));

      const p1Info = await getPlayerInfoById(match.player1, match.player1Name);
      const p2Info = await getPlayerInfoById(match.player2, match.player2Name);

      room = {
        white: myColor === 'w' ? socket.id : null,
        black: myColor === 'b' ? socket.id : null,
        currentTurn: 'w', rematchReady: new Set(), drawOfferBy: null,
        timer: null, status: 'waiting', playerInfo: { w: p1Info, b: p2Info }, matchId: null,
        tokens: { w: createRoomToken(), b: createRoomToken() },
        game: createGameState(), moves: [],
        clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, clockInterval: null,
        tournamentMeta: { eventId: String(event._id), round, matchIndex },
      };
      rooms.set(code, room);

      match.roomCode = code;
      // Update atomico de un solo campo (no event.save() de todo el
      // documento) -- asi no pisa cambios concurrentes de OTRO partido
      // de la misma ronda que se este resolviendo al mismo tiempo.
      await Event.updateOne({ _id: event._id }, {
        $set: { [`bracket.rounds.${round}.matches.${matchIndex}.roomCode`]: code },
      }).catch((err) => console.warn('[Tournament] No se pudo guardar roomCode:', err.message));

      await Room.findOneAndUpdate(
        { roomCode: code },
        { $set: {
          roomCode: code,
          'players.white.socketId': room.white, 'players.white.userId': p1Info.userId, 'players.white.name': p1Info.name, 'players.white.country': p1Info.country, 'players.white.avatar': p1Info.avatar, 'players.white.avatarImage': p1Info.avatarImage || '',
          'players.black.socketId': room.black, 'players.black.userId': p2Info.userId, 'players.black.name': p2Info.name, 'players.black.country': p2Info.country, 'players.black.avatar': p2Info.avatar, 'players.black.avatarImage': p2Info.avatarImage || '',
          fen: 'startpos', turn: 'w', gameState: createGameSnapshot(room.game),
          'tokens.w': room.tokens.w, 'tokens.b': room.tokens.b,
          'tournamentMeta.eventId': event._id, 'tournamentMeta.round': round, 'tournamentMeta.matchIndex': matchIndex,
          clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS, status: 'waiting', lastActivityAt: new Date(),
        }},
        { upsert: true, new: true }
      ).catch((err) => console.warn('[DB] No se pudo guardar sala de torneo:', err.message));

      console.log(`[Tournament] Sala ${code} creada — ${event.title} ronda ${round + 1} (${p1Info.name} vs ${p2Info.name})`);
    } else {
      if (myColor === 'w') room.white = socket.id; else room.black = socket.id;
    }

    socket.join(match.roomCode);
    socket.data.roomCode = match.roomCode;
    socket.data.color = myColor;
    socket.data.playerName = (myColor === 'w' ? room.playerInfo.w?.name : room.playerInfo.b?.name) || socket.data.playerName;
    if (onlinePlayers.has(socket.id)) onlinePlayers.get(socket.id).inGame = true;
    broadcastOnlinePlayers();

    if (room.white && room.black && room.status === 'waiting') {
      room.status = 'playing';
      const createdMatch = await Match.create({
        whitePlayer: playerSnapshot(room.playerInfo.w),
        blackPlayer: playerSnapshot(room.playerInfo.b),
        roomCode: match.roomCode, result: 'in_progress', startedAt: new Date(),
      }).catch((err) => { console.warn('[DB] Match create error (tournament):', err.message); return null; });
      if (createdMatch) room.matchId = createdMatch._id;

      await Room.updateOne({ roomCode: match.roomCode }, {
        $set: { match: createdMatch?._id || null, status: 'playing', lastActivityAt: new Date() },
      }).catch(() => {});

      match.status = 'playing';
      await Event.updateOne({ _id: event._id }, {
        $set: { [`bracket.rounds.${round}.matches.${matchIndex}.status`]: 'playing' },
      }).catch(() => {});

      const wSocket = io.sockets.sockets.get(room.white);
      const bSocket = io.sockets.sockets.get(room.black);
      wSocket?.emit('game-start', { code: match.roomCode, color: 'w', roomToken: room.tokens.w, playerInfo: { w: room.playerInfo.w, b: room.playerInfo.b }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
      bSocket?.emit('game-start', { code: match.roomCode, color: 'b', roomToken: room.tokens.b, playerInfo: { w: room.playerInfo.w, b: room.playerInfo.b }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
      startClock(match.roomCode);
      console.log(`[Tournament] Sala ${match.roomCode} arranco — ${room.playerInfo.w.name} vs ${room.playerInfo.b.name}`);
    } else {
      socket.emit('game-start', { code: match.roomCode, color: myColor, roomToken: room.tokens[myColor], playerInfo: { w: room.playerInfo.w, b: room.playerInfo.b }, clockW: DEFAULT_TIME_MS, clockB: DEFAULT_TIME_MS });
    }
  });

  // ── DAMAS (checkers) — namespace de eventos y estado totalmente
  //    separado del ajedrez (damasRooms, nunca `rooms`). Ningun
  //    handler de arriba se toca ni se modifica para esto.
  socket.on('damas:create-room', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.createRoom, payload, 'damas:room-error');
    if (!data) return;
    if (!(await consumeDamasLimit('damasCreateRoom', 'damas:room-error'))) return;
    // A proposito sin requireSocketAuth(): Damas permite jugar como
    // invitado en la web. getPlayerInfo() ya sabe devolver un perfil de
    // invitado (userId: null) cuando socket.data.user no existe.
    const { playerName = 'Jugador 1', country = 'DO' } = data;

    let code;
    do { code = generateCode(); } while (rooms.has(code) || damasRooms.has(code));

    const pInfo = await getPlayerInfo(playerName, country);
    // getPlayerInfo() es compartido con ajedrez y devuelve el elo de
    // ajedrez; Damas tiene su propio ranking.
    if (socket.data.user) pInfo.elo = Number(socket.data.user.damasElo ?? 1200);

    damasRooms.set(code, {
      white: socket.id, black: null,
      board: OzamaCheckers.createInitialBoard(),
      turn: OzamaCheckers.COLOR.WHITE,
      status: 'waiting',
      playerInfo: { w: pInfo, b: null },
      tokens: { w: createRoomToken(), b: null },
      closeTimer: null,
      createdAt: Date.now(),
    });

    socket.join(code);
    socket.data.damasRoomCode = code;
    socket.data.damasColor = 'w';

    socket.emit('damas:room-created', { code, color: 'w', playerInfo: pInfo, roomToken: damasRooms.get(code).tokens.w });
    console.log(`[DAMAS] Sala ${code} creada por "${pInfo.name}"`);
  });

  socket.on('damas:join-room', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.joinRoom, payload, 'damas:room-error');
    if (!data) return;
    if (!(await consumeDamasLimit('damasJoinRoom', 'damas:room-error'))) return;
    const { code, playerName = 'Jugador 2', country = 'DO' } = data;

    const room = damasRooms.get(code);
    if (!room) { socket.emit('damas:room-error', 'La sala no existe.'); return; }
    if (room.black) { socket.emit('damas:room-error', 'La sala ya esta llena.'); return; }
    if (room.white === socket.id) { socket.emit('damas:room-error', 'No puedes unirte a tu propia sala.'); return; }

    const pInfo = await getPlayerInfo(playerName, country);
    if (socket.data.user) pInfo.elo = Number(socket.data.user.damasElo ?? 1200);
    room.black = socket.id;
    room.playerInfo.b = pInfo;
    room.tokens.b = createRoomToken();
    room.status = 'playing';
    room.startedAt = new Date();

    socket.join(code);
    socket.data.damasRoomCode = code;
    socket.data.damasColor = 'b';

    const whiteSocket = io.sockets.sockets.get(room.white);
    const startPayload = { code, board: room.board, turn: room.turn, playerInfo: room.playerInfo };
    whiteSocket?.emit('damas:game-start', { ...startPayload, color: 'w', roomToken: room.tokens.w });
    socket.emit('damas:game-start', { ...startPayload, color: 'b', roomToken: room.tokens.b });
    console.log(`[DAMAS] "${pInfo.name}" se unio a la sala ${code}`);
  });

  // ── Jugadores en linea + desafiar (version Damas) ───────────────
  // Solo para usuarios logueados -- un invitado no tiene un nombre
  // estable contra el cual otro jugador pueda desafiarlo. Reusa los
  // mismos schemas de zod que Ajedrez (no tienen nada especifico del
  // juego), pero listas/eventos separados: son perfiles y ELO
  // distintos, y una sala de Damas, no de Ajedrez.
  socket.on('damas:player-online', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.playerOnline, payload);
    if (!data) return;
    if (!requireSocketAuth()) return;
    const { username, elo = 1200, country = 'DO' } = data;
    const info = await getPlayerInfo(username, country);
    damasOnlinePlayers.set(socket.id, {
      username: info.name,
      country: info.country,
      avatar: info.avatar || 0,
      avatarImage: info.avatarImage || '',
      elo: Number(socket.data.user?.damasElo ?? elo ?? 1200),
      inGame: !!socket.data.damasRoomCode,
    });
    broadcastDamasOnlinePlayers();
  });

  socket.on('damas:challenge-send', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSend, payload, 'damas:challenge-error');
    if (!data) return;
    if (!(await consumeSocketLimit('challengeSend', 'damas:challenge-error'))) return;
    const { targetUsername } = data;
    if (!requireSocketAuth('Debes iniciar sesión para desafiar.')) return;
    const cleanTarget = String(targetUsername || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(cleanTarget)) {
      socket.emit('damas:challenge-error', 'Jugador invalido.');
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
      socket.emit('damas:challenge-error', 'El jugador no está conectado en este momento.');
      return;
    }
    if (targetSocket.id === socket.id) {
      socket.emit('damas:challenge-error', 'No puedes desafiarte a ti mismo.');
      return;
    }
    if (targetSocket.data.damasRoomCode) {
      socket.emit('damas:challenge-error', 'El jugador ya está en una partida.');
      return;
    }

    const challenger = await User.findById(socket.data.userId).select('username country avatar avatarImage damasElo').lean();
    if (!challenger) {
      socket.emit('damas:challenge-error', 'Tu sesion ya no es valida.');
      return;
    }
    if (!damasPendingChallenges.has(targetSocket.id)) damasPendingChallenges.set(targetSocket.id, new Set());
    damasPendingChallenges.get(targetSocket.id).add(socket.id);

    targetSocket.emit('damas:challenge-received', {
      from: { username: challenger.username, country: challenger.country, avatar: challenger.avatar, avatarImage: challenger.avatarImage, elo: challenger.damasElo },
      socketId: socket.id,
    });
    socket.emit('damas:challenge-sent', { to: targetUsername });
    console.log(`[DAMAS] ${challenger.username} desafió a ${targetUsername}`);
  });

  socket.on('damas:challenge-accept', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSocket, payload, 'damas:challenge-error');
    if (!data) return;
    const { challengerSocketId } = data;
    if (!requireSocketAuth()) return;
    const pending = damasPendingChallenges.get(socket.id);
    if (!pending?.has(challengerSocketId)) {
      socket.emit('damas:challenge-error', 'Este desafio ya no es valido.');
      return;
    }
    pending.delete(challengerSocketId);
    if (!pending.size) damasPendingChallenges.delete(socket.id);
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (!challengerSocket || !challengerSocket.connected) {
      socket.emit('damas:challenge-error', 'El rival ya no está disponible.');
      return;
    }
    if (!challengerSocket.data.userId) {
      socket.emit('damas:challenge-error', 'El rival perdió la sesión.');
      return;
    }

    const pInfo = await getPlayerInfo();
    if (socket.data.user) pInfo.elo = Number(socket.data.user.damasElo ?? 1200);
    const cUser = await User.findById(challengerSocket.data.userId).select('username country avatar avatarImage damasElo').lean();
    const cInfo = cUser
      ? { userId: cUser._id, name: cUser.username, country: cUser.country, avatar: cUser.avatar, avatarImage: cUser.avatarImage, elo: cUser.damasElo }
      : { userId: null, name: challengerSocket.data.playerName || 'Jugador', country: 'DO', avatar: 0, avatarImage: '', elo: 1200 };

    let code;
    do { code = generateCode(); } while (rooms.has(code) || damasRooms.has(code));

    const flip = Math.random() < 0.5;
    const wSock = flip ? challengerSocket : socket;
    const bSock = flip ? socket : challengerSocket;
    const wInfo = flip ? cInfo : pInfo;
    const bInfo = flip ? pInfo : cInfo;

    damasRooms.set(code, {
      white: wSock.id, black: bSock.id,
      board: OzamaCheckers.createInitialBoard(),
      turn: OzamaCheckers.COLOR.WHITE,
      status: 'playing',
      playerInfo: { w: wInfo, b: bInfo },
      tokens: { w: createRoomToken(), b: createRoomToken() },
      closeTimer: null,
      createdAt: Date.now(),
      startedAt: new Date(),
    });

    wSock.join(code); bSock.join(code);
    wSock.data.damasRoomCode = code; wSock.data.damasColor = 'w';
    bSock.data.damasRoomCode = code; bSock.data.damasColor = 'b';

    const newRoom = damasRooms.get(code);
    const startPayload = { code, board: newRoom.board, turn: newRoom.turn, playerInfo: newRoom.playerInfo };
    wSock.emit('damas:game-start', { ...startPayload, color: 'w', roomToken: newRoom.tokens.w });
    bSock.emit('damas:game-start', { ...startPayload, color: 'b', roomToken: newRoom.tokens.b });
    console.log(`[DAMAS] Desafío aceptado, sala ${code}`);
  });

  socket.on('damas:challenge-decline', (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.challengeSocket, payload, 'damas:challenge-error');
    if (!data) return;
    const { challengerSocketId } = data;
    const pending = damasPendingChallenges.get(socket.id);
    if (!pending?.has(challengerSocketId)) return;
    pending.delete(challengerSocketId);
    if (!pending.size) damasPendingChallenges.delete(socket.id);
    const challengerSocket = io.sockets.sockets.get(challengerSocketId);
    if (challengerSocket) {
      challengerSocket.emit('damas:challenge-declined', { by: socket.data.playerName || socket.data.user?.username || 'El jugador' });
    }
  });

  socket.on('damas:move', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.move, payload, 'damas:move-rejected');
    if (!data) return;
    if (!(await consumeDamasLimit('damasMove', 'damas:move-rejected'))) return;
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
    // Guardado para el logro "Primera Coronacion" -- se lee al cerrar
    // la partida (finishDamasGame), no hace falta nada mas alla de
    // este flag por color.
    if (result.promoted) { room.hadPromotion = room.hadPromotion || {}; room.hadPromotion[myColor] = true; }
    const status = OzamaCheckers.checkGameOver(room.board, room.turn);
    if (status.over) room.status = 'finished';

    io.to(code).emit('damas:board-update', {
      board: room.board,
      turn: room.turn,
      lastMove: { fromR, fromC, toR: result.to.r, toC: result.to.c },
      capturedCount: result.captured.length,
      gameOver: status.over ? status : null,
    });

    if (status.over) await finishDamasGame(room, code, { winner: status.winner, reason: status.reason });
  });

  socket.on('damas:resign', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.roomOnly, payload, 'damas:room-error');
    if (!data) return;
    const { room: code } = data;
    const room = damasRooms.get(code);
    if (!room) return;
    const myColor = socket.data.damasColor;
    if (!myColor || room.status !== 'playing') return;
    damasCancelCloseTimer(room);
    room.status = 'finished';
    const winner = OzamaCheckers.otherColor(myColor);
    io.to(code).emit('damas:game-over', { winner, reason: 'resign' });
    await finishDamasGame(room, code, { winner, reason: 'resign' });
  });

  // Reconectar a una partida de Damas en curso tras perder el socket
  // (recargar la pagina, WiFi, la app pasando a segundo plano). El
  // token de sala es lo unico que hace falta -- no requiere sesion,
  // igual que el resto de Damas, para que un invitado tambien pueda
  // recuperar su partida.
  socket.on('damas:rejoin', async (payload = {}) => {
    const data = parseSocketPayload(damasSchemas.rejoin, payload, 'damas:rejoin-failed');
    if (!data) return;
    const { room: code, color, token } = data;
    const room = damasRooms.get(code);
    if (!room || room.status !== 'playing') { socket.emit('damas:rejoin-failed'); return; }
    if (!room.tokens?.[color] || room.tokens[color] !== token) { socket.emit('damas:rejoin-failed'); return; }

    damasCancelCloseTimer(room);
    socket.join(code);
    socket.data.damasRoomCode = code;
    socket.data.damasColor = color;
    if (color === 'w') room.white = socket.id; else room.black = socket.id;

    socket.emit('damas:game-start', { code, color, board: room.board, turn: room.turn, playerInfo: room.playerInfo, roomToken: token });
    socket.to(code).emit('damas:opponent-reconnected');
    console.log(`[DAMAS] Reconexion en sala ${code} (${color})`);
  });

  // ── TORNEOS DE DAMAS: entrar a tu partido del bracket ───────────
  // Mismo bracket/Event que ajedrez (services/tournament.js es
  // agnostico al juego) pero la sala se arma en damasRooms/DamasMatch,
  // nunca en `rooms`/Match. Reusa el mismo esquema de payload que la
  // version de ajedrez (eventId/round/matchIndex, sin nada especifico
  // de un juego). En vez de reimplementar el flujo de "unirse", arma
  // la sala YA lista (status:'playing', ambos tokens) y le dice al
  // cliente que la reconstruya con el mismo camino que ya usa
  // damas.html para reconectarse (attemptAutoRejoin -> damas:rejoin)
  // -- cero codigo nuevo del lado del cliente para "entrar" de cero.
  socket.on('tournament:join-match-damas', async (payload = {}) => {
    const data = parseSocketPayload(socketSchemas.tournamentJoinMatch, payload, 'tournament:error');
    if (!data) return;
    if (!requireSocketAuth()) return;
    const { eventId, round, matchIndex } = data;

    const event = await Event.findById(eventId).catch(() => null);
    if (!event || event.type !== 'tournament') { socket.emit('tournament:error', 'Torneo no encontrado.'); return; }
    if (event.gameType !== 'checkers') { socket.emit('tournament:error', 'Este torneo no es de Damas.'); return; }
    const match = event.bracket?.rounds?.[round]?.matches?.[matchIndex];
    if (!match) { socket.emit('tournament:error', 'Partido no encontrado.'); return; }

    const userId = String(socket.data.userId);
    const isP1 = match.player1 && String(match.player1) === userId;
    const isP2 = match.player2 && String(match.player2) === userId;
    if (!isP1 && !isP2) { socket.emit('tournament:error', 'No sos parte de este partido.'); return; }
    if (match.status !== 'ready' && match.status !== 'playing') {
      socket.emit('tournament:error', 'Este partido no esta disponible ahora mismo.');
      return;
    }
    const myColor = isP1 ? 'w' : 'b';

    let roomCode = match.roomCode || null;
    let room = roomCode ? damasRooms.get(roomCode) : null;

    if (!room) {
      let code;
      do { code = generateCode(); } while (rooms.has(code) || damasRooms.has(code));

      // Igual que getPlayerInfoById, pero con el ELO de Damas -- ese
      // helper devuelve el de ajedrez, y aca hace falta el otro.
      async function damasPlayerInfoById(pUserId, fallbackName) {
        if (pUserId) {
          const u = await User.findById(pUserId).select('username country avatar avatarImage damasElo').lean().catch(() => null);
          if (u) return { userId: u._id, name: u.username, country: u.country, avatar: u.avatar, avatarImage: u.avatarImage, elo: u.damasElo };
        }
        return { userId: pUserId || null, name: fallbackName || 'Jugador', country: 'DO', avatar: 0, avatarImage: '', elo: 1200 };
      }
      const p1Info = await damasPlayerInfoById(match.player1, match.player1Name);
      const p2Info = await damasPlayerInfoById(match.player2, match.player2Name);

      const candidateRoom = {
        white: null, black: null,
        board: OzamaCheckers.createInitialBoard(),
        turn: OzamaCheckers.COLOR.WHITE,
        status: 'playing',
        playerInfo: { w: p1Info, b: p2Info },
        tokens: { w: createRoomToken(), b: createRoomToken() },
        closeTimer: null, createdAt: Date.now(), startedAt: new Date(),
        tournamentMeta: { eventId: String(event._id), round, matchIndex },
      };

      // Reclamo atomico del roomCode -- si los dos jugadores llaman
      // este handler casi al mismo tiempo, sin esto cada uno podria
      // ver roomCode=null y crear su PROPIA sala (confirmado con un
      // test real: ambos terminaban con codigos de sala distintos
      // para el mismo partido). Concurrencia optimista sobre __v en
      // vez de filtrar por el valor de un campo dentro de un array
      // doblemente anidado (bracket.rounds.N.matches.M.campo) -- se
      // probo a mano y ESE filtro no funciona como cabria esperar en
      // Mongo (matchea aunque el valor no sea el buscado); __v es un
      // campo plano, sin esa trampa.
      const claim = await Event.updateOne(
        { _id: event._id, __v: event.__v },
        { $set: {
          [`bracket.rounds.${round}.matches.${matchIndex}.roomCode`]: code,
          [`bracket.rounds.${round}.matches.${matchIndex}.status`]: 'playing',
        }, $inc: { __v: 1 } },
      ).catch((err) => { console.warn('[Tournament] No se pudo reclamar la sala (damas):', err.message); return null; });
      const claimed = !!claim?.modifiedCount;

      if (claimed) {
        room = candidateRoom;
        roomCode = code;
        damasRooms.set(code, room);
        console.log(`[Tournament] Sala de Damas ${code} creada — ${event.title} ronda ${round + 1} (${p1Info.name} vs ${p2Info.name})`);
      } else {
        // Perdi la carrera: otro socket ya reclamo el partido. Releo
        // cual sala quedo y me sumo a esa en vez de la mia.
        const fresh = await Event.findById(event._id).select('bracket.rounds').lean();
        roomCode = fresh?.bracket?.rounds?.[round]?.matches?.[matchIndex]?.roomCode || null;
        room = roomCode ? damasRooms.get(roomCode) : null;
        if (!room) { socket.emit('tournament:error', 'No se pudo entrar al partido, intenta de nuevo.'); return; }
      }
    }

    socket.emit('tournament:damas-match-ready', { code: roomCode, color: myColor, roomToken: room.tokens[myColor] });
  });

  socket.on('disconnect', () => {
    const damasCode = socket.data.damasRoomCode;
    const damasRoom = damasCode ? damasRooms.get(damasCode) : null;
    if (damasRoom) {
      if (damasRoom.white === socket.id) damasRoom.white = null;
      if (damasRoom.black === socket.id) damasRoom.black = null;
      if (damasRoom.status === 'playing') {
        // No se da la partida por terminada de una vez: se avisa al
        // rival y se le da 30s para reconectar (damas:rejoin) antes de
        // cerrar la sala de verdad.
        socket.to(damasCode).emit('damas:opponent-disconnected');
        damasStartCloseTimer(damasCode);
      } else if (!damasRoom.white && !damasRoom.black) {
        damasRooms.delete(damasCode);
      }
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

    damasOnlinePlayers.delete(socket.id);
    damasPendingChallenges.delete(socket.id);
    for (const [targetId, challengers] of damasPendingChallenges) {
      challengers.delete(socket.id);
      if (!challengers.size) damasPendingChallenges.delete(targetId);
    }
    broadcastDamasOnlinePlayers();

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
