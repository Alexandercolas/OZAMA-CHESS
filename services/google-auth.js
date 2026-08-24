'use strict';

const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client();

function configuredClientIds() {
  return [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    ...String(process.env.GOOGLE_CLIENT_IDS || '').split(','),
  ]
    .map((value) => String(value || '').trim())
    .filter((value, index, list) => value && list.indexOf(value) === index);
}

function googleProviderConfig() {
  const clientId = String(process.env.GOOGLE_WEB_CLIENT_ID || '').trim();
  return {
    enabled: Boolean(clientId),
    clientId,
  };
}

async function verifyGoogleIdToken(idToken) {
  const audience = configuredClientIds();
  if (!audience.length) {
    const error = new Error('Google sign-in is not configured.');
    error.code = 'GOOGLE_NOT_CONFIGURED';
    throw error;
  }

  const credential = String(idToken || '').trim();
  if (!credential || credential.length > 12_000) {
    const error = new Error('Invalid Google credential.');
    error.code = 'GOOGLE_INVALID_CREDENTIAL';
    throw error;
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience,
    });
  } catch (_) {
    const error = new Error('Invalid Google credential.');
    error.code = 'GOOGLE_INVALID_CREDENTIAL';
    throw error;
  }
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    const error = new Error('Unverified Google account.');
    error.code = 'GOOGLE_UNVERIFIED_ACCOUNT';
    throw error;
  }

  return {
    sub: String(payload.sub),
    email: String(payload.email).trim().toLowerCase(),
    name: String(payload.name || '').trim(),
  };
}

module.exports = {
  configuredClientIds,
  googleProviderConfig,
  verifyGoogleIdToken,
};
