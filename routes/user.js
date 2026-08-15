'use strict';

const express              = require('express');
const User                 = require('../models/User');
const Match                = require('../models/Match');
const Room                 = require('../models/Room');
const Event                = require('../models/Event');
const { requireAuth }      = require('../middleware/auth');

const router = express.Router();

function validUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(String(value || ''));
}

function serverError(res, scope, err) {
  console.error(`[User] ${scope}:`, err.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

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

function publicLeaderboardFilter() {
  return {
    isActive: true,
    username: {
      $nin: ['imgsrconeerror'],
      $not: /^sec[A-D]_\d{8}$/i,
    },
  };
}

// GET /api/user/me - own profile
router.get('/me', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ user: req.user });
});

router.get('/plan', requireAuth, async (req, res) => {
  res.json(premiumCapabilities(req.user));
});

// PATCH /api/user/me - update profile
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
    if (updates.country !== undefined) {
      const country = String(updates.country || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Pais invalido.' });
      updates.country = country;
    }
    if (updates.avatar !== undefined) {
      const avatar = Number(updates.avatar);
      if (!Number.isInteger(avatar) || avatar < 0 || avatar > 12) {
        return res.status(400).json({ error: 'Avatar invalido.' });
      }
      updates.avatar = avatar;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.json({ user });
  } catch (err) {
    console.error('[User] Update profile:', err.message);
    res.status(400).json({ error: 'Datos de perfil invalidos.' });
  }
});

// GET /api/user/history - match history
router.get('/history', requireAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
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
    serverError(res, 'History', err);
  }
});

// GET /api/user/leaderboard - top 20 by ELO
router.get('/leaderboard', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const players = await User.find(publicLeaderboardFilter())
      .sort({ elo: -1 })
      .limit(20)
      .select('username country avatar avatarImage elo stats plan');

    res.json({ players });
  } catch (err) {
    serverError(res, 'Leaderboard', err);
  }
});

// PUT /api/user/password - change password with active session
router.put('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Contrasena actual y nueva contrasena son obligatorias.' });
    }
    if (String(newPassword).length < 8 || String(newPassword).length > 128) {
      return res.status(400).json({ error: 'La nueva contrasena debe tener entre 8 y 128 caracteres.' });
    }

    const user = await User.findById(req.user._id).select('+password +tokenVersion');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ error: 'Contrasena actual incorrecta.' });

    user.password = newPassword;
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();

    res.json({ message: 'Contrasena actualizada correctamente.' });
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
    serverError(res, 'Friends list', err);
  }
});

router.post('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Usuario requerido.' });
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

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
    serverError(res, 'Add friend', err);
  }
});

router.delete('/friends/:username', requireAuth, async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });
    const friend = await User.findOne({ username: { $regex: `^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }).select('_id');
    if (!friend) return res.status(404).json({ error: 'Usuario no encontrado.' });

    await Promise.all([
      User.updateOne({ _id: req.user._id }, { $pull: { friends: friend._id } }),
      User.updateOne({ _id: friend._id }, { $pull: { friends: req.user._id } }),
    ]);

    res.json({ ok: true });
  } catch (err) {
    serverError(res, 'Remove friend', err);
  }
});

// DELETE /api/user/me - permanently remove the account and personal data.
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const confirmation = String(req.body.confirmation || '').trim().toUpperCase();

    if (!currentPassword || confirmation !== 'ELIMINAR') {
      return res.status(400).json({ error: 'Confirma tu contrasena y escribe ELIMINAR.' });
    }
    if (currentPassword.length > 128) {
      return res.status(400).json({ error: 'Contrasena invalida.' });
    }

    const userId = req.user._id;
    const user = await User.findById(userId).select('+password');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const validPassword = await user.comparePassword(currentPassword);
    if (!validPassword) return res.status(401).json({ error: 'Contrasena incorrecta.' });

    const deletedPlayer = {
      userId: null,
      name: 'Jugador eliminado',
      country: '--',
      avatar: 0,
      avatarImage: '',
    };

    await Promise.all([
      User.updateMany({ friends: userId }, { $pull: { friends: userId } }),
      Match.updateMany({ 'whitePlayer.userId': userId }, {
        $set: {
          'whitePlayer.userId': deletedPlayer.userId,
          'whitePlayer.name': deletedPlayer.name,
          'whitePlayer.country': deletedPlayer.country,
          'whitePlayer.avatar': deletedPlayer.avatar,
          'whitePlayer.avatarImage': deletedPlayer.avatarImage,
        },
      }),
      Match.updateMany({ 'blackPlayer.userId': userId }, {
        $set: {
          'blackPlayer.userId': deletedPlayer.userId,
          'blackPlayer.name': deletedPlayer.name,
          'blackPlayer.country': deletedPlayer.country,
          'blackPlayer.avatar': deletedPlayer.avatar,
          'blackPlayer.avatarImage': deletedPlayer.avatarImage,
        },
      }),
      Room.updateMany({ 'players.white.userId': userId }, {
        $set: {
          'players.white.userId': null,
          'players.white.name': deletedPlayer.name,
          'players.white.country': deletedPlayer.country,
          'players.white.avatar': 0,
          'players.white.avatarImage': '',
        },
      }),
      Room.updateMany({ 'players.black.userId': userId }, {
        $set: {
          'players.black.userId': null,
          'players.black.name': deletedPlayer.name,
          'players.black.country': deletedPlayer.country,
          'players.black.avatar': 0,
          'players.black.avatarImage': '',
        },
      }),
      Event.updateMany({ createdBy: userId }, { $set: { createdBy: null } }),
    ]);

    await User.deleteOne({ _id: userId });

    const io = req.app.get('io');
    if (io?.sockets?.sockets) {
      for (const [, socket] of io.sockets.sockets) {
        if (String(socket.data?.userId || '') === String(userId)) socket.disconnect(true);
      }
    }

    return res.json({ ok: true, message: 'Cuenta eliminada correctamente.' });
  } catch (err) {
    return serverError(res, 'Delete account', err);
  }
});

router.get('/:username', async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    if (!validUsername(username)) return res.status(400).json({ error: 'Usuario invalido.' });

    const user = await User.findOne({ username })
      .select('username country avatar avatarImage elo stats plan createdAt');

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    res.json({ user });
  } catch (err) {
    serverError(res, 'Public profile', err);
  }
});

module.exports = router;
