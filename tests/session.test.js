'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  requestToken,
  socketToken,
  protectCookieWrites,
} = require('../middleware/session');

function request({ method = 'PATCH', authorization = '', cookie = '', origin = '', fetchSite = '' } = {}) {
  const headers = { authorization, cookie };
  if (origin) headers.origin = origin;
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  return {
    method,
    protocol: 'https',
    headers,
    get(name) {
      if (String(name).toLowerCase() === 'host') return 'ozama-chess.onrender.com';
      return headers[String(name).toLowerCase()] || '';
    },
  };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('Bearer takes precedence while cookie remains a fallback', () => {
  assert.equal(requestToken(request({
    authorization: 'Bearer native-token',
    cookie: 'ozama_session=web-token',
  })), 'native-token');
  assert.equal(requestToken(request({ cookie: 'theme=dark; ozama_session=web-token' })), 'web-token');
});

test('Socket.IO accepts the same cookie fallback used by HTTP', () => {
  assert.equal(socketToken({ handshake: { auth: {}, headers: { cookie: 'ozama_session=socket-cookie' } } }), 'socket-cookie');
  assert.equal(socketToken({ handshake: { auth: { token: 'socket-bearer' }, headers: {} } }), 'socket-bearer');
});

test('cookie-authenticated writes require the same origin', () => {
  let nextCalls = 0;
  const allowedResponse = response();
  protectCookieWrites(request({
    cookie: 'ozama_session=web-token',
    origin: 'https://ozama-chess.onrender.com',
  }), allowedResponse, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(allowedResponse.statusCode, 200);

  const blockedResponse = response();
  protectCookieWrites(request({
    cookie: 'ozama_session=web-token',
    origin: 'https://attacker.example',
  }), blockedResponse, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.equal(blockedResponse.statusCode, 403);
  assert.match(blockedResponse.body.error, /Origen/);
});

test('native Bearer writes do not depend on browser Origin headers', () => {
  let allowed = false;
  protectCookieWrites(request({
    authorization: 'Bearer native-token',
    origin: 'https://localhost',
  }), response(), () => { allowed = true; });
  assert.equal(allowed, true);
});
