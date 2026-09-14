'use strict';

// Limpieza de las bases de datos AISLADAS y TEMPORALES que los
// scripts verify-*.js van creando (createIsolatedMongoEnv, ver
// scripts/test-db-guard.js) -- cada corrida crea una base nueva con
// timestamp (ozama_test_..._<13 digitos>, ozama_dynamic_test_...,
// etc.) y nunca la borra sola. El plan gratis de Atlas tiene un tope
// de 500 colecciones en TOTAL para todo el cluster -- acumular
// suficientes bases de prueba lo alcanza tarde o temprano (confirmado
// en vivo: "cannot create a new collection -- already using 501
// collections of 500" al intentar registrar un usuario nuevo).
//
// Reusa el MISMO patron de nombre que ya usa assertSafeTestDatabase
// (scripts/test-db-guard.js) para reconocer una base temporal -- nunca
// toca "ozama-chess" (produccion) ni ninguna otra base que no matchee
// ese patron exacto.
//
// Por defecto, dry-run (solo lista que borraria). Uso:
//   node scripts/cleanup-test-databases.js            (dry-run)
//   node scripts/cleanup-test-databases.js --confirm   (borra de verdad)

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { dbNameFromUri } = require('./test-db-guard');

const TEMP_DB_PATTERN = /^ozama_(?:dynamic|test|security|tmp)[a-z0-9_]*_\d{8,}$/i;

async function main() {
  const confirm = process.argv.includes('--confirm');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI no esta definida en .env');

  const productionDbName = dbNameFromUri(uri) || 'ozama-chess';

  const client = new MongoClient(uri);
  await client.connect();
  console.log('[cleanup-db] Conectado a Atlas.');

  const { databases } = await client.db().admin().listDatabases();
  const tempDbs = databases
    .map((d) => d.name)
    .filter((name) => name !== productionDbName && TEMP_DB_PATTERN.test(name));

  console.log(`[cleanup-db] ${databases.length} base(s) en total en el cluster, ${tempDbs.length} son temporales de prueba:`);
  for (const name of tempDbs) console.log(`  - ${name}`);

  if (!tempDbs.length) {
    console.log('[cleanup-db] Nada que borrar.');
  } else if (!confirm) {
    console.log('\n[cleanup-db] Esto fue solo una vista previa (dry-run). Nada se borro.');
    console.log('[cleanup-db] Vuelve a correr con --confirm para borrarlas de verdad:');
    console.log('  node scripts/cleanup-test-databases.js --confirm');
  } else {
    for (const name of tempDbs) {
      await client.db(name).dropDatabase();
      console.log(`  borrada: ${name}`);
    }
    console.log(`[cleanup-db] ${tempDbs.length} base(s) de prueba borradas.`);
  }

  await client.close();
}

main().catch((err) => {
  console.error('[cleanup-db] Error:', err.message);
  process.exit(1);
});
