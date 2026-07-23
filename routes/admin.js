'use strict';

const express = require('express');
const Event = require('../models/Event');
const Match = require('../models/Match');
const User = require('../models/User');
const { requireAdmin, userIsAdmin } = require('../middleware/auth');

const router = express.Router();

function eventPayload(body) {
  return {
    title: String(body.title || '').trim(),
    type: body.type || 'event',
    status: body.status || 'draft',
    description: String(body.description || '').trim(),
    startsAt: body.startsAt ? new Date(body.startsAt) : null,
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    maxPlayers: Number(body.maxPlayers || 16),
  };
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
      updates.premiumUntil = req.body.premiumUntil ? new Date(req.body.premiumUntil) : null;
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
    const payload = eventPayload(req.body);
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
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
