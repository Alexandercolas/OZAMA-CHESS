'use strict';

const express              = require('express');
const User                 = require('../models/User');
const Match                = require('../models/Match');
const { requireAuth }      = require('../middleware/auth');

const router = express.Router();

function premiumCapabilities(user) {
  const premiumUntil = user?.premiumUntil ? new Date(user.premiumUntil) : null;
  const premiumActive = user?.plan === 'premium' && (!premiumUntil || premiumUntil > new Date());
  return {
    plan: user?.plan || 'free',
    premiumActive,
    premiumUntil,
    subscriptionStatus: user?.subscriptionStatus || 'none',
    benefits: premiumActive ? [
      'Temas visuales premium',
      'Avatares exclusivos',
      'Estadisticas avanzadas',
      'Confort de sala',
    ] : [],
  };
}

// ── GET /api/user/me — perfil propio ────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

router.get('/plan', requireAuth, async (req, res) => {
  res.json(premiumCapabilities(req.user));
});

// ── PATCH /api/user/me — actualizar perfil ──────────────────────
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const allowed = ['country', 'avatar', 'avatarImage'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    if (updates.avatarImage !== undefined) {
      const image = String(updates.avatarImage || '');
      if (image && !/^data:image\/(png|jpeg|webp);base64,/.test(image)) {
        return res.status(400).json({ error: 'Formato de foto invalido.' });
      }
      if (image.length > 450000) {
        return res.status(413).json({ error: 'La foto es demasiado grande.' });
      }
      updates.avatarImage = image;
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
      .select('username country avatar avatarImage elo stats plan');

    res.json({ players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/user/:username — perfil público ────────────────────
// PUT /api/user/password - cambiar contraseña con sesión activa
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contraseña actual y nueva contraseña son obligatorias.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta.' });

    user.password = newPassword;
    await user.save();

    res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.get('/friends', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'username country avatar avatarImage elo stats lastSeenAt')
      .select('friends')
      .lean();

    res.json({ friends: user?.friends || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Usuario requerido.' });

    const friend = await User.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } })
      .select('username country avatar avatarImage elo stats');

    if (!friend) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (friend._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'No puedes agregarte a ti mismo.' });
    }

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $addToSet: { friends: friend._id } }),
      User.updateOne({ _id: friend._id }, { $addToSet: { friends: req.user._id } }),
    ]);

    res.json({ friend });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    const friend = await User.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).select('_id');
    if (!friend) return res.status(404).json({ error: 'Usuario no encontrado.' });

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friends: friend._id } }),
      User.updateOne({ _id: friend._id }, { $pull: { friends: req.user._id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username })
      .select('username country avatar avatarImage elo stats plan createdAt');

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
