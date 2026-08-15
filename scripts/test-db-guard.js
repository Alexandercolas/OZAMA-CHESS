'use strict';

const DEFAULT_PRODUCTION_DB = 'ozama-chess';
const TEMP_DB_PATTERN = /^ozama_(?:dynamic|test|security|tmp)[a-z0-9_]*_\d{8,}$/i;

function parseMongoUri(uri) {
  if (!uri || !/^mongodb(?:\+srv)?:\/\//i.test(uri)) {
    throw new Error('MONGODB_URI must be a real MongoDB URI.');
  }
  return new URL(uri);
}

function dbNameFromUri(uri) {
  const parsed = parseMongoUri(uri);
  return decodeURIComponent(parsed.pathname.replace(/^\//, '') || '');
}

function uriWithDbName(uri, dbName) {
  const parsed = parseMongoUri(uri);
  parsed.pathname = `/${encodeURIComponent(dbName)}`;
  return parsed.toString();
}

function assertSafeTestDatabase({ uri, dbName, productionDbName = DEFAULT_PRODUCTION_DB } = {}) {
  const targetDbName = String(dbName || dbNameFromUri(uri) || '').trim();
  const prodDbName = String(productionDbName || DEFAULT_PRODUCTION_DB).trim();

  if (!targetDbName) throw new Error('Test MongoDB database name is required.');
  if (targetDbName === prodDbName) {
    throw new Error(`Refusing to run test script against production database "${prodDbName}".`);
  }
  if (!TEMP_DB_PATTERN.test(targetDbName)) {
    throw new Error(`Refusing to run test script against non-temporary database "${targetDbName}".`);
  }
  return targetDbName;
}

function createIsolatedMongoEnv({ env = process.env, prefix = 'ozama_dynamic_test' } = {}) {
  const sourceUri = env.MONGODB_URI || '';
  parseMongoUri(sourceUri);

  const dbName = `${prefix}_${Date.now()}`;
  const uri = uriWithDbName(sourceUri, dbName);
  assertSafeTestDatabase({
    uri,
    dbName,
    productionDbName: env.OZAMA_PRODUCTION_DB_NAME || DEFAULT_PRODUCTION_DB,
  });

  return {
    uri,
    dbName,
    env: {
      MONGODB_URI: uri,
      MONGODB_DB_NAME: dbName,
    },
  };
}

module.exports = {
  assertSafeTestDatabase,
  createIsolatedMongoEnv,
  dbNameFromUri,
  uriWithDbName,
};
