'use strict';

const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

const router  = express.Router();

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// ── POST /api/auth/register ─────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, country = 'DO' } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email y password son obligatorios.' });
    }

    const exists = await User.findOne({
      $or: [
        { email:    email.toLowerCase().trim() },
        { username: username.trim() },
      ],
    });

    if (exists) {
      const field = exists.email === email.toLowerCase().trim() ? 'Email' : 'Usuario';
      return res.status(409).json({ error: `${field} ya registrado.` });
    }

    const user  = await User.create({ username: username.trim(), email, password, country });
    const token = signToken(user._id);

    return res.status(201).json({
      token,
      user: {
        id:       user._id,
        username: user.username,
        email:    user.email,
        country:  user.country,
        avatar:   user.avatar,
        elo:      user.elo,
        stats:    user.stats,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Usuario o email ya en uso.' });
    }
    if (err.name === 'ValidationError') {
      const msg = Object.values(err.errors).map((e) => e.message).join(' ');
      return res.status(400).json({ error: msg });
    }
    console.error('[Auth] Register error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body; // identifier = username o email

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Credenciales incompletas.' });
    }

    const user = await User.findOne({
      $or: [
        { email:    identifier.toLowerCase().trim() },
        { username: identifier.trim() },
      ],
    }).select('+password');

    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    user.lastSeenAt = new Date();
    await user.save({ validateModifiedOnly: true });

    const token = signToken(user._id);

    return res.json({
      token,
      user: {
        id:       user._id,
        username: user.username,
        email:    user.email,
        country:  user.country,
        avatar:   user.avatar,
        elo:      user.elo,
        stats:    user.stats,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;