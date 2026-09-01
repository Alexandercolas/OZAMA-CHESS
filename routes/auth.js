'use strict';

const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { requestToken, setSessionCookie, clearSessionCookie } = require('../middleware/session');
const { googleProviderConfig, verifyGoogleIdToken } = require('../services/google-auth');
const { recaptchaProviderConfig, verifyRecaptchaToken } = require('../services/recaptcha');
const { rateLimit } = require('../middleware/rateLimit');

const router  = express.Router();

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

const limitGoogle = rateLimit({
  bucket: 'google',
  limit: 12,
  windowMs: 10 * 60 * 1000,
  message: 'Demasiados intentos con Google. Intenta de nuevo en unos minutos.',
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
    preferences: user.preferences || {},
  };
}

function googleUsernameBase(name, email) {
  const source = String(name || '').trim() || String(email || '').split('@')[0] || 'ozama';
  let base = source
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (base.length < 3) base = `oz_${base || 'player'}`;
  return base.slice(0, 20);
}

async function uniqueGoogleUsername(name, email, sub) {
  const base = googleUsernameBase(name, email);
  if (!(await User.exists({ username: base }))) return base;

  const stableSuffix = String(sub || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'google';
  const stable = `${base.slice(0, Math.max(3, 19 - stableSuffix.length))}_${stableSuffix}`.slice(0, 20);
  if (!(await User.exists({ username: stable }))) return stable;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = crypto.randomInt(1000, 10_000);
    const candidate = `${base.slice(0, 15)}_${suffix}`.slice(0, 20);
    if (!(await User.exists({ username: candidate }))) return candidate;
  }
  throw new Error('No se pudo reservar un nombre de usuario.');
}

async function findGoogleUser({ sub, email, name }) {
  let user = await User.findOne({ googleSub: sub }).select('+googleSub +tokenVersion');
  if (user) return user;

  user = await User.findOne({ email }).select('+googleSub +tokenVersion');
  if (user) {
    if (user.googleSub && user.googleSub !== sub) {
      const error = new Error('Google account conflict.');
      error.code = 'GOOGLE_ACCOUNT_CONFLICT';
      throw error;
    }
    user.googleSub = sub;
    if (!user.authProviders) user.authProviders = { password: true, google: false };
    user.authProviders.google = true;
    user.lastSeenAt = new Date();
    await user.save({ validateModifiedOnly: true });
    return user;
  }

  const username = await uniqueGoogleUsername(name, email, sub);
  const generatedPassword = `${crypto.randomBytes(32).toString('base64url')}Aa1!`;
  return User.create({
    username,
    email,
    password: generatedPassword,
    country: 'DO',
    googleSub: sub,
    authProviders: { password: false, google: true },
    lastSeenAt: new Date(),
  });
}

router.get('/providers', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ google: googleProviderConfig(), recaptcha: recaptchaProviderConfig() });
});

router.post('/google', limitGoogle, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const identity = await verifyGoogleIdToken(req.body.idToken || req.body.credential);
    const user = await findGoogleUser(identity);

    if (!user?.isActive) {
      return res.status(401).json({ error: 'No se pudo iniciar sesion con Google.' });
    }

    user.lastSeenAt = new Date();
    await user.save({ validateModifiedOnly: true });

    const token = signToken(user);
    setSessionCookie(res, token);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'El acceso con Google aun no esta configurado.' });
    }
    if (err.code === 'GOOGLE_ACCOUNT_CONFLICT') {
      return res.status(409).json({ error: 'No se pudo vincular esta cuenta de Google.' });
    }
    if (err.code === 11000) {
      return res.status(409).json({ error: 'La cuenta ya esta vinculada. Intenta iniciar sesion otra vez.' });
    }
    if (err.code === 'GOOGLE_INVALID_CREDENTIAL'
      || err.code === 'GOOGLE_UNVERIFIED_ACCOUNT') {
      console.warn(`[Auth] Google credential rejected: ${err.code || err.name}`);
      return res.status(401).json({ error: 'No se pudo verificar la cuenta de Google.' });
    }
    console.error('[Auth] Google error:', err.name || 'UnknownError');
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

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

    const captchaOk = await verifyRecaptchaToken(req.body.recaptchaToken, {
      action: 'register',
      remoteip: req.ip,
    });
    if (!captchaOk) {
      return res.status(400).json({ error: 'No se pudo verificar que eres una persona. Recarga la pagina e intenta de nuevo.' });
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
    setSessionCookie(res, token);

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

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    user.lastSeenAt = new Date();
    await user.save({ validateModifiedOnly: true });

    const token = signToken(user);
    setSessionCookie(res, token);

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
    clearSessionCookie(res);

    return res.json({
      message: 'Contrasena actualizada. Guarda tu nuevo codigo de recuperacion.',
      recoveryCode: nextRecoveryCode,
    });
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true });
});

router.post('/migrate-session', requireAuth, (req, res) => {
  setSessionCookie(res, requestToken(req));
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true });
});

module.exports = router;
