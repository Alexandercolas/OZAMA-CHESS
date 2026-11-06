'use strict';

require('dotenv').config({ quiet: true });

const assert = require('node:assert/strict');
const { randomInt } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const mongoose = require('mongoose');
const { assertSafeTestDatabase, createIsolatedMongoEnv } = require('./test-db-guard');

const isolated = createIsolatedMongoEnv({ prefix: 'ozama_test_health' });
assertSafeTestDatabase({
  uri: isolated.uri,
  dbName: isolated.dbName,
  productionDbName: process.env.OZAMA_PRODUCTION_DB_NAME,
});
Object.assign(process.env, isolated.env, {
  PORT: String(randomInt(35000, 50000)),
  NODE_ENV: 'test',
  JWT_SECRET: 'db-health-test-secret-at-least-32-chars',
});

const url = `http://127.0.0.1:${process.env.PORT}/api/health/db`;
require('../server');

async function main() {
  for (let attempt = 0; attempt < 60 && mongoose.connection.readyState !== 1; attempt++) {
    await delay(500);
  }
  assert.equal(mongoose.connection.readyState, 1, 'La base de prueba no conecto');

  const connected = await fetch(url);
  assert.equal(connected.status, 200);
  assert.deepEqual(await connected.json(), { database: 'connected' });
  assert.match(connected.headers.get('cache-control') || '', /no-store/);
  console.log('HEALTH_CONNECTED=200 connected');

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  const disconnected = await fetch(url);
  assert.equal(disconnected.status, 503);
  assert.deepEqual(await disconnected.json(), { database: 'disconnected' });
  console.log('HEALTH_DISCONNECTED=503 disconnected');
  console.log('TEST_DB_DROPPED=true');
}

main().then(() => process.exit(0), async (error) => {
  console.error('DB_HEALTH_FAILED:', error.stack || error.message);
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(1);
});
