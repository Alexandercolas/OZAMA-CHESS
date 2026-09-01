'use strict';

// Rate limiter HTTP generico por IP -- extraido de routes/auth.js
// (donde vivia privado, solo para login/registro/reset/Google) para
// poder reusarlo en otras rutas sin duplicar la logica. Un solo Map
// compartido para todos los buckets de todas las rutas que lo usen,
// igual que el original.
const attempts = new Map();

function getClientKey(req, bucket) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return `${bucket}:${forwarded || req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function rateLimit({ bucket, limit, windowMs, message }) {
  return (req, res, next) => {
    const key = getClientKey(req, bucket);
    const now = Date.now();
    const entry = attempts.get(key);

    if (!entry || entry.resetAt <= now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
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

module.exports = { rateLimit };
