'use strict';

const express              = require('express');
const User                 = require('../models/User');
const Match                = require('../models/Match');
const { requireAuth }      = require('../middleware/auth');

const router = express.Router();

// ── GET /api/user/me — perfil propio ────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

// ── PATCH /api/user/me — actualizar perfil ──────────────────────
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const allowed = ['country', 'avatar'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /api/user/history — historial de partidas ───────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(20, parseInt(req.query.limit) || 10);

    const filter = {
      $or: [
        { 'whitePlayer.userId': userId },
        { 'blackPlayer.userId': userId },
      ],
      result: { $ne: 'in_progress' },
    };

    const [matches, total] = await Promise.all([
      Match.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Match.countDocuments(filter),
    ]);

    res.json({ matches, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user/leaderboard — top 20 por ELO ─────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const players = await User.find({ isActive: true })
      .sort({ elo: -1 })
      .limit(20)
      .select('username country avatar elo stats');

    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user/:username — perfil público ────────────────────
router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username country avatar elo stats createdAt');

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;