'use strict';

const express = require('express');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Match = require('../models/Match');
const User = require('../models/User');
const { requireAdmin, userIsAdmin } = require('../middleware/auth');

const router = express.Router();

const allowedEventTypes = new Set(['event', 'tournament', 'announcement', 'maintenance']);
const allowedEventStatuses = new Set(['draft', 'published', 'closed']);

function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function cleanString(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function parseDateField(value, field) {
  if (!value) return null;
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
    if (!allowedEventTypes.has(type)) {
      const err = new Error('Tipo de evento invalido.');
      err.statusCode = 400;
      throw err;
    }
    payload.type = type;
  }
  if (!partial || body.status !== undefined) {
    const status = String(body.status || 'draft');
    if (!allowedEventStatuses.has(status)) {
      const err = new Error('Estado de evento invalido.');
      err.statusCode = 400;
      throw err;
    }
    payload.status = status;
  }
  if (!partial || body.description !== undefined) payload.description = cleanString(body.description, 1200);
  if (!partial || body.startsAt !== undefined) payload.startsAt = parseDateField(body.startsAt, 'Fecha inicial');
  if (!partial || body.endsAt !== undefined) payload.endsAt = parseDateField(body.endsAt, 'Fecha final');
  if (!partial || body.maxPlayers !== undefined) {
    const maxPlayers = Number(body.maxPlayers || 16);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 512) {
      const err = new Error('Maximo de jugadores invalido.');
      err.statusCode = 400;
      throw err;
    }
    payload.maxPlayers = maxPlayers;
  }

  return payload;
}

router.get('/me', requireAdmin, (req, res) => {
  res.json({
    admin: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      isAdmin: userIsAdmin(req.user),
    },
  });
});

router.get('/stats', requireAdmin, async (_req, res) => {
  try {
    const [users, activeUsers, matches, finishedMatches, events, publishedEvents] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ isActive: true }),
      Match.countDocuments(),
      Match.countDocuments({ result: { $ne: 'in_progress' } }),
      Event.countDocuments(),
      Event.countDocuments({ status: 'published' }),
    ]);

    res.json({ users, activeUsers, matches, finishedMatches, events, publishedEvents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/events', requireAdmin, async (_req, res) => {
  try {
    const events = await Event.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('createdBy', 'username email')
      .lean();
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', requireAdmin, async (_req, res) => {
  try {
    const users = await User.find()
      .sort({ createdAt: -1 })
      .limit(80)
      .select('username email country avatar avatarImage elo stats plan premiumUntil subscriptionStatus isAdmin isActive lastSeenAt createdAt')
      .lean();

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/plan', requireAdmin, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Usuario invalido.' });

    const updates = {};
    const allowedPlans = new Set(['free', 'premium']);
    const allowedStatuses = new Set(['none', 'trial', 'active', 'past_due', 'cancelled']);

    if (req.body.plan !== undefined) {
      if (!allowedPlans.has(req.body.plan)) return res.status(400).json({ error: 'Plan invalido.' });
      updates.plan = req.body.plan;
    }
    if (req.body.subscriptionStatus !== undefined) {
      if (!allowedStatuses.has(req.body.subscriptionStatus)) return res.status(400).json({ error: 'Estado invalido.' });
      updates.subscriptionStatus = req.body.subscriptionStatus;
    }
    if (req.body.premiumUntil !== undefined) {
      updates.premiumUntil = parseDateField(req.body.premiumUntil, 'Fecha premium');
    }
    if (req.body.isAdmin !== undefined) {
      updates.isAdmin = !!req.body.isAdmin;
    }
    if (req.body.isActive !== undefined) {
      updates.isActive = !!req.body.isActive;
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select('username email country elo stats plan premiumUntil subscriptionStatus isAdmin isActive');

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/events', requireAdmin, async (req, res) => {
  try {
    const payload = eventPayload(req.body);
    payload.createdBy = req.user._id;

    if (!payload.title) return res.status(400).json({ error: 'Titulo requerido.' });
    if (payload.endsAt && payload.startsAt && payload.endsAt < payload.startsAt) {
      return res.status(400).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    }

    const event = await Event.create(payload);
    res.status(201).json({ event });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/events/:id', requireAdmin, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });

    const payload = eventPayload(req.body, { partial: true });
    if (!payload.title) delete payload.title;
    if (payload.endsAt && payload.startsAt && payload.endsAt < payload.startsAt) {
      return res.status(400).json({ error: 'La fecha final no puede ser anterior al inicio.' });
    }

    const event = await Event.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });

    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    res.json({ event });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/events/:id', requireAdmin, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });

    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
