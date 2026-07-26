'use strict';

const jwt  = require('jsonwebtoken');
const User = require('../models/User');

function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function userIsAdmin(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  return adminEmails().includes(String(user.email || '').toLowerCase());
}

// Required auth middleware
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Token requerido.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    const user    = await User.findById(decoded.id).select('+tokenVersion');

    if (!user || !user.isActive || Number(decoded.v || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Usuario no valido.' });
    }

    req.user = user;
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError'
      ? 'Sesion expirada. Vuelve a iniciar sesion.'
      : 'Token invalido.';
    return res.status(401).json({ error: msg });
  }
}

// Optional auth middleware. It does not block anonymous requests.
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
      const user = await User.findById(decoded.id).select('+tokenVersion');
      if (user?.isActive && Number(decoded.v || 0) === Number(user.tokenVersion || 0)) {
        req.user = user;
      }
    }
  } catch (_) { /* silencioso */ }
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (!userIsAdmin(req.user)) {
      return res.status(403).json({ error: 'Acceso admin requerido.' });
    }
    return next();
  });
}

module.exports = { requireAuth, optionalAuth, requireAdmin, userIsAdmin };
