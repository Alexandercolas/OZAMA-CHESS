'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');

const router  = express.Router();
const authAttempts = new Map();

function getClientKey(req, bucket) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return `${bucket}:${forwarded || req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function rateLimit({ bucket, limit, windowMs, message }) {
  return (req, res, next) => {
    const key = getClientKey(req, bucket);
    const now = Date.now();
    const entry = authAttempts.get(key);

    if (!entry || entry.resetAt <= now) {
      authAttempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message || 'Demasiados intentos. Espera un momento.' });
    }

    return next();
  };
}

const limitRegister = rateLimit({
  bucket: 'register',
  limit: 8,
  windowMs: 10 * 60 * 1000,
  message: 'Demasiados registros desde esta conexion. Intenta mas tarde.',
});

const limitLogin = rateLimit({
  bucket: 'login',
  limit: 12,
  windowMs: 10 * 60 * 1000,
  message: 'Demasiados intentos de acceso. Intenta de nuevo en unos minutos.',
});

const limitReset = rateLimit({
  bucket: 'reset',
  limit: 6,
  windowMs: 15 * 60 * 1000,
  message: 'Demasiados intentos de recuperacion. Intenta mas tarde.',
});

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function generateRecoveryCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// ── POST /api/auth/register ─────────────────────────────────────
router.post('/register', limitRegister, async (req, res) => {
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

    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);
    const user  = await User.create({
      username: username.trim(),
      email,
      password,
      country,
      recoveryCodeHash,
    });
    const token = signToken(user._id);

    return res.status(201).json({
      token,
      user: {
        id:       user._id,
        username: user.username,
        email:    user.email,
        country:  user.country,
        avatar:   user.avatar,
        avatarImage: user.avatarImage,
        elo:      user.elo,
        stats:    user.stats,
        plan:     user.plan,
        premiumUntil: user.premiumUntil,
        subscriptionStatus: user.subscriptionStatus,
      },
      recoveryCode,
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
router.post('/login', limitLogin, async (req, res) => {
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
        avatarImage: user.avatarImage,
        elo:      user.elo,
        stats:    user.stats,
        plan:     user.plan,
        premiumUntil: user.premiumUntil,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', limitReset, async (req, res) => {
  try {
    const { identifier, recoveryCode, newPassword } = req.body;

    if (!identifier || !recoveryCode || !newPassword) {
      return res.status(400).json({ error: 'Usuario/email, código y nueva contraseña son obligatorios.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const cleanIdentifier = String(identifier).trim();
    const user = await User.findOne({
      $or: [
        { email: cleanIdentifier.toLowerCase() },
        { username: cleanIdentifier },
      ],
    }).select('+password +recoveryCodeHash');

    if (!user) {
      return res.status(401).json({ error: 'Datos de recuperación incorrectos.' });
    }

    const validCode = await user.compareRecoveryCode(recoveryCode);
    if (!validCode) {
      return res.status(401).json({ error: 'Datos de recuperación incorrectos.' });
    }

    user.password = newPassword;
    await user.save();

    return res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
