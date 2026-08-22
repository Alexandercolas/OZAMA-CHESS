'use strict';

const SESSION_COOKIE = 'ozama_session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try { cookies[key] = decodeURIComponent(rawValue); }
    catch (_) { cookies[key] = rawValue; }
  }
  return cookies;
}

function bearerToken(req) {
  const header = String(req?.headers?.authorization || '');
  if (!header.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

function cookieToken(req) {
  return parseCookies(req?.headers?.cookie)[SESSION_COOKIE] || '';
}

function requestToken(req) {
  return bearerToken(req) || cookieToken(req);
}

function socketToken(socket) {
  return String(socket?.handshake?.auth?.token || '').trim()
    || parseCookies(socket?.handshake?.headers?.cookie)[SESSION_COOKIE]
    || '';
}

function cookieOptions(req) {
  const hostedOverHttps = Boolean(req?.secure)
    || process.env.NODE_ENV === 'production'
    || process.env.RENDER === 'true'
    || Boolean(process.env.RENDER_EXTERNAL_URL);
  return {
    httpOnly: true,
    secure: hostedOverHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions(res.req));
  res.set('Cache-Control', 'no-store');
}

function clearSessionCookie(res) {
  const { maxAge: _maxAge, ...options } = cookieOptions(res.req);
  res.clearCookie(SESSION_COOKIE, options);
}

function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get('host');
  return host ? `${protocol}://${host}` : '';
}

// Cookie-authenticated writes need a same-origin browser request. Native clients
// keep using Bearer auth, so Capacitor remains compatible during the migration.
function protectCookieWrites(req, res, next) {
  if (SAFE_METHODS.has(req.method) || bearerToken(req) || !cookieToken(req)) return next();

  const origin = String(req.get('origin') || '');
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if ((origin && origin === requestOrigin(req)) || (!origin && fetchSite === 'same-origin')) {
    return next();
  }

  return res.status(403).json({ error: 'Origen de solicitud no permitido.' });
}

module.exports = {
  SESSION_COOKIE,
  bearerToken,
  cookieToken,
  requestToken,
  socketToken,
  setSessionCookie,
  clearSessionCookie,
  protectCookieWrites,
};
