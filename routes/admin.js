'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const AdminAudit = require('../models/AdminAudit');
const Event = require('../models/Event');
const Match = require('../models/Match');
const User = require('../models/User');
const { requireAdmin, userIsAdmin } = require('../middleware/auth');

const router = express.Router();
const allowedEventTypes = new Set(['event', 'tournament', 'announcement', 'maintenance']);
const allowedEventStatuses = new Set(['draft', 'active', 'finished', 'cancelled', 'published', 'closed']);
const publicUserFields = 'username email country avatar avatarImage elo stats plan premiumUntil subscriptionStatus isActive lastSeenAt createdAt updatedAt';

const boundaryLimiter = new RateLimiterMemory({ points: 180, duration: 60, blockDuration: 60 });
const adminLimiter = new RateLimiterMemory({ points: 100, duration: 60, blockDuration: 60 });

function limitWith(limiter, keyFromRequest) {
  return async (req, res, next) => {
    try {
      await limiter.consume(keyFromRequest(req));
      return next();
    } catch (rateInfo) {
      const retryAfter = Math.max(1, Math.ceil(Number(rateInfo?.msBeforeNext || 1000) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Demasiadas solicitudes administrativas. Intenta mas tarde.' });
    }
  };
}

router.use(limitWith(boundaryLimiter, (req) => `ip:${req.ip}`));
router.use(requireAdmin);
router.use(limitWith(adminLimiter, (req) => `admin:${req.user._id}`));

function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function cleanString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function positiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseDateField(value, field) {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${field} invalida.`);
    err.statusCode = 400;
    throw err;
  }
  return date;
}

function eventPayload(body, { partial = false } = {}) {
  const payload = {};
  if (!partial || body.title !== undefined) payload.title = cleanString(body.title, 90);
  if (!partial || body.type !== undefined) {
    const type = String(body.type || 'event');
    if (!allowedEventTypes.has(type)) throw Object.assign(new Error('Tipo de evento invalido.'), { statusCode: 400 });
    payload.type = type;
  }
  if (!partial || body.status !== undefined) {
    const status = String(body.status || 'draft');
    if (!allowedEventStatuses.has(status)) throw Object.assign(new Error('Estado de evento invalido.'), { statusCode: 400 });
    payload.status = status;
  }
  if (!partial || body.description !== undefined) payload.description = cleanString(body.description, 1200);
  if (!partial || body.startsAt !== undefined) payload.startsAt = parseDateField(body.startsAt, 'Fecha inicial');
  if (!partial || body.endsAt !== undefined) payload.endsAt = parseDateField(body.endsAt, 'Fecha final');
  if (!partial || body.maxPlayers !== undefined) {
    const maxPlayers = Number(body.maxPlayers || 16);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 512) {
      throw Object.assign(new Error('Maximo de jugadores invalido.'), { statusCode: 400 });
    }
    payload.maxPlayers = maxPlayers;
  }
  return payload;
}

function runtimeFor(req) {
  return req.app.locals.adminRuntime || null;
}

function serializeUser(user) {
  const value = typeof user?.toObject === 'function' ? user.toObject() : { ...user };
  return {
    _id: value._id,
    username: value.username,
    email: value.email,
    country: value.country,
    avatar: value.avatar,
    avatarImage: value.avatarImage,
    elo: value.elo,
    stats: value.stats,
    plan: value.plan,
    isPremium: value.plan === 'premium',
    premiumUntil: value.premiumUntil,
    subscriptionStatus: value.subscriptionStatus,
    isActive: value.isActive,
    isAdmin: userIsAdmin(value),
    lastSeenAt: value.lastSeenAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

async function writeAudit(req, action, targetType, targetId, metadata = {}) {
  try {
    await AdminAudit.create({
      actor: req.user._id,
      action,
      targetType,
      targetId: cleanString(targetId, 120),
      metadata,
      ip: cleanString(req.ip, 64),
      userAgent: cleanString(req.get('user-agent'), 240),
    });
  } catch (err) {
    console.warn('[AdminAudit]', err.message);
  }
}

router.get(['/verify', '/me'], (req, res) => {
  res.json({
    admin: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      isAdmin: true,
    },
  });
});

router.get('/stats', async (req, res) => {
  try {
    const runtime = runtimeFor(req)?.snapshot?.() || {
      socketConnections: 0,
      onlineUsers: 0,
      activeRooms: 0,
      waitingPlayers: 0,
    };
    const [totalUsers, activeAccounts, totalMatches, finishedMatches, activeEvents] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Match.countDocuments(),
      Match.countDocuments({ result: { $ne: 'in_progress' } }),
      Event.countDocuments({ status: { $in: ['active', 'published'] } }),
    ]);
    res.json({
      users: { total: totalUsers, activeAccounts, online: runtime.onlineUsers },
      sockets: { connections: runtime.socketConnections },
      rooms: { active: runtime.activeRooms, waitingPlayers: runtime.waitingPlayers },
      damasRooms: { active: runtime.activeDamasRooms || 0 },
      matches: { total: totalMatches, finished: finishedMatches, active: Math.max(0, totalMatches - finishedMatches) },
      events: { active: activeEvents },
    });
  } catch (err) {
    console.error('[Admin] Stats:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las metricas.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const page = positiveInt(req.query.page, 1, 100000);
    const limit = positiveInt(req.query.limit, 20, 50);
    const search = cleanString(req.query.q, 80);
    const query = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ username: regex }, { email: regex }];
    }
    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(publicUserFields)
        .lean(),
      User.countDocuments(query),
    ]);
    res.json({ users: users.map(serializeUser), page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error('[Admin] Users:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar los usuarios.' });
  }
});

async function updateUser(req, res) {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Usuario invalido.' });
    const user = await User.findById(req.params.id).select(`${publicUserFields} +tokenVersion`);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const isSelf = String(user._id) === String(req.user._id);
    let invalidateSessions = req.body.invalidateSessions === true;
    const changes = {};

    if (req.body.isActive !== undefined) {
      if (typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'Estado de usuario invalido.' });
      if (isSelf && !req.body.isActive) return res.status(400).json({ error: 'No puedes suspender tu propia cuenta administradora.' });
      if (user.isActive !== req.body.isActive) {
        user.isActive = req.body.isActive;
        changes.isActive = user.isActive;
        if (!user.isActive) invalidateSessions = true;
      }
    }

    const premiumRequested = req.body.isPremium !== undefined
      ? req.body.isPremium
      : req.body.plan !== undefined
        ? req.body.plan === 'premium'
        : undefined;
    if (premiumRequested !== undefined) {
      if (typeof premiumRequested !== 'boolean') return res.status(400).json({ error: 'Estado Premium invalido.' });
      user.plan = premiumRequested ? 'premium' : 'free';
      user.subscriptionStatus = premiumRequested ? 'active' : 'none';
      if (!premiumRequested) user.premiumUntil = null;
      changes.plan = user.plan;
    }

    if (req.body.premiumUntil !== undefined) {
      user.premiumUntil = parseDateField(req.body.premiumUntil, 'Fecha premium');
      changes.premiumUntil = user.premiumUntil;
    }

    if (invalidateSessions) {
      if (isSelf) return res.status(400).json({ error: 'No puedes cerrar tu propia sesion desde este control.' });
      user.tokenVersion = Number(user.tokenVersion || 0) + 1;
      changes.sessionsRevoked = true;
    }

    await user.save({ validateModifiedOnly: true });
    if (invalidateSessions) runtimeFor(req)?.disconnectUser?.(String(user._id));
    await writeAudit(req, 'user.updated', 'user', String(user._id), changes);
    return res.json({ user: serializeUser(user) });
  } catch (err) {
    return res.status(err.statusCode || 400).json({ error: err.message || 'No se pudo actualizar el usuario.' });
  }
}

router.patch('/users/:id', updateUser);
router.patch('/users/:id/plan', updateUser);

router.get('/rooms/active', (req, res) => {
  const rooms = runtimeFor(req)?.rooms?.() || [];
  res.json({ rooms, total: rooms.length });
});

router.delete('/rooms/:code', async (req, res) => {
  const code = cleanString(req.params.code, 6).toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Codigo de sala invalido.' });
  }
  try {
    const closed = await runtimeFor(req)?.closeRoom?.(code, 'Cierre administrativo de emergencia.');
    if (!closed) return res.status(404).json({ error: 'La sala ya no esta activa.' });
    await writeAudit(req, 'room.closed', 'room', code, { previousStatus: closed.status });
    return res.json({ ok: true, room: closed });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo cerrar la sala.' });
  }
});

router.get('/damas-rooms/active', (req, res) => {
  const rooms = runtimeFor(req)?.damasRooms?.() || [];
  res.json({ rooms, total: rooms.length });
});

router.delete('/damas-rooms/:code', async (req, res) => {
  const code = cleanString(req.params.code, 6).toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) {
    return res.status(400).json({ error: 'Codigo de sala invalido.' });
  }
  try {
    const closed = runtimeFor(req)?.closeDamasRoom?.(code, 'Cierre administrativo de emergencia.');
    if (!closed) return res.status(404).json({ error: 'La sala ya no esta activa.' });
    await writeAudit(req, 'damas_room.closed', 'damas_room', code, { previousStatus: closed.status });
    return res.json({ ok: true, room: closed });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo cerrar la sala.' });
  }
});

router.get('/matches', async (req, res) => {
  try {
    const page = positiveInt(req.query.page, 1, 100000);
    const limit = positiveInt(req.query.limit, 20, 40);
    const search = cleanString(req.query.q, 80);
    const query = { result: { $ne: 'in_progress' } };
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      query.$or = [{ roomCode: regex }, { 'whitePlayer.name': regex }, { 'blackPlayer.name': regex }];
    }
    const [matches, total] = await Promise.all([
      Match.find(query)
        .sort({ endedAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('roomCode whitePlayer blackPlayer result winner pgn eloChange startedAt endedAt createdAt moves')
        .lean(),
      Match.countDocuments(query),
    ]);
    res.json({
      matches: matches.map((match) => ({ ...match, moveCount: match.moves?.length || 0, moves: undefined })),
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('[Admin] Matches:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar las partidas.' });
  }
});

router.get('/events', async (_req, res) => {
  try {
    const events = await Event.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('createdBy', 'username email')
      .populate('participants', 'username country elo')
      .lean();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron cargar los eventos.' });
  }
});

router.post('/events', async (req, res) => {
  try {
    const payload = eventPayload(req.body);
    payload.createdBy = req.user._id;
    if (!payload.title) return res.status(400).json({ error: 'Titulo requerido.' });
    if (payload.endsAt && payload.startsAt && payload.endsAt < payload.startsAt) {
      return res.status(400).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    }
    const event = await Event.create(payload);
    await writeAudit(req, 'event.created', 'event', String(event._id), { type: event.type, status: event.status });
    res.status(201).json({ event });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message || 'No se pudo crear el evento.' });
  }
});

router.patch('/events/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    const payload = eventPayload(req.body, { partial: true });
    const startsAt = payload.startsAt !== undefined ? payload.startsAt : event.startsAt;
    const endsAt = payload.endsAt !== undefined ? payload.endsAt : event.endsAt;
    if (endsAt && startsAt && endsAt < startsAt) {
      return res.status(400).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    }
    Object.assign(event, payload);
    await event.save({ validateModifiedOnly: true });
    await writeAudit(req, 'event.updated', 'event', String(event._id), { status: event.status });
    res.json({ event });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message || 'No se pudo actualizar el evento.' });
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    await writeAudit(req, 'event.deleted', 'event', String(event._id), { title: event.title });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo eliminar el evento.' });
  }
});

router.get('/system', async (req, res) => {
  try {
    const [logs, runtime] = await Promise.all([
      AdminAudit.find()
        .sort({ createdAt: -1 })
        .limit(80)
        .select('actor action targetType targetId metadata createdAt')
        .populate('actor', 'username email')
        .lean(),
      Promise.resolve(runtimeFor(req)?.snapshot?.() || {}),
    ]);
    const memory = process.memoryUsage();
    res.json({
      system: {
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(memory.rss / 1024 / 1024),
        node: process.version,
        runtime,
      },
      logs,
    });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo cargar el estado del sistema.' });
  }
});

module.exports = router;
