'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configuredClientIds,
  googleProviderConfig,
  verifyGoogleIdToken,
} = require('../services/google-auth');

const ENV_KEYS = [
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_ANDROID_CLIENT_ID',
  'GOOGLE_CLIENT_IDS',
];

function isolateGoogleEnv(t) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  for (const key of ENV_KEYS) delete process.env[key];
}

test('Google sign-in stays disabled when no client ID is configured', async (t) => {
  isolateGoogleEnv(t);
  assert.deepEqual(googleProviderConfig(), { enabled: false, clientId: '' });
  assert.deepEqual(configuredClientIds(), []);
  await assert.rejects(
    () => verifyGoogleIdToken('not-a-token'),
    (error) => error.code === 'GOOGLE_NOT_CONFIGURED',
  );
});

test('Google verifier accepts a deduplicated web, Android, and extra audience list', (t) => {
  isolateGoogleEnv(t);
  process.env.GOOGLE_WEB_CLIENT_ID = 'web.apps.googleusercontent.com';
  process.env.GOOGLE_ANDROID_CLIENT_ID = 'android.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_IDS = 'web.apps.googleusercontent.com,other.apps.googleusercontent.com';

  assert.deepEqual(configuredClientIds(), [
    'web.apps.googleusercontent.com',
    'android.apps.googleusercontent.com',
    'other.apps.googleusercontent.com',
  ]);
  assert.deepEqual(googleProviderConfig(), {
    enabled: true,
    clientId: 'web.apps.googleusercontent.com',
  });
});
