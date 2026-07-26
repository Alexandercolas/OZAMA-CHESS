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

function signToken(user) {
  return jwt.sign(
    { id: user._id, v: Number(user.tokenVersion || 0) },
    process.env.JWT_SECRET,
    { expiresIn: '7d', algorithm: 'HS256' }
  );
}

function generateRecoveryCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function normalizeCountry(value) {
  return String(value || 'DO').trim().toUpperCase();
}

function validUsername(value) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(value);
}

function validCountry(value) {
  return /^[A-Z]{2}$/.test(value);
}

function publicUser(user) {
  return {
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
  };
}

router.post('/register', limitRegister, async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username);
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const country = normalizeCountry(req.body.country);

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email y password son obligatorios.' });
    }
    if (!validUsername(username)) {
      return res.status(400).json({ error: 'Usuario invalido. Usa 3-20 caracteres, letras, numeros o guion bajo.' });
    }
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'La contrasena debe tener entre 8 y 128 caracteres.' });
    }
    if (!validCountry(country)) {
      return res.status(400).json({ error: 'Pais invalido.' });
    }

    const exists = await User.findOne({
      $or: [
        { email },
        { username },
      ],
    });

    if (exists) {
      const field = exists.email === email ? 'Email' : 'Usuario';
      return res.status(409).json({ error: `${field} ya registrado.` });
    }

    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = await bcrypt.hash(recoveryCode, 12);
    const user  = await User.create({
      username,
      email,
      password,
      country,
      recoveryCodeHash,
    });
    const token = signToken(user);

    return res.status(201).json({
      token,
      user: publicUser(user),
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

router.post('/login', limitLogin, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || '').trim();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Credenciales incompletas.' });
    }

    const user = await User.findOne({
      $or: [
        { email: normalizeEmail(identifier) },
        { username: identifier },
      ],
    }).select('+password +tokenVersion');

    if (!user) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    user.lastSeenAt = new Date();
    await user.save({ validateModifiedOnly: true });

    const token = signToken(user);

    return res.json({
      token,
      user: publicUser(user),
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/reset-password', limitReset, async (req, res) => {
  try {
    const identifier = String(req.body.identifier || '').trim();
    const recoveryCode = String(req.body.recoveryCode || '').trim().toUpperCase();
    const newPassword = String(req.body.newPassword || '');

    if (!identifier || !recoveryCode || !newPassword) {
      return res.status(400).json({ error: 'Usuario/email, codigo y nueva contrasena son obligatorios.' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'La nueva contrasena debe tener entre 8 y 128 caracteres.' });
    }
    if (!/^[A-F0-9]{8}$/.test(recoveryCode)) {
      return res.status(401).json({ error: 'Datos de recuperacion incorrectos.' });
    }

    const user = await User.findOne({
      $or: [
        { email: normalizeEmail(identifier) },
        { username: identifier },
      ],
    }).select('+password +recoveryCodeHash +tokenVersion');

    if (!user) {
      return res.status(401).json({ error: 'Datos de recuperacion incorrectos.' });
    }

    const validCode = await user.compareRecoveryCode(recoveryCode);
    if (!validCode) {
      return res.status(401).json({ error: 'Datos de recuperacion incorrectos.' });
    }

    const nextRecoveryCode = generateRecoveryCode();
    user.password = newPassword;
    user.recoveryCodeHash = await bcrypt.hash(nextRecoveryCode, 12);
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();

    return res.json({
      message: 'Contrasena actualizada. Guarda tu nuevo codigo de recuperacion.',
      recoveryCode: nextRecoveryCode,
    });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
