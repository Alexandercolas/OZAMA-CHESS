'use strict';

// Restaura un backup hecho con scripts/backup-mongo.js.
//
// Por seguridad, POR DEFECTO restaura contra una base de datos nueva
// y temporal (nunca la de produccion) -- sirve para verificar que un
// backup realmente sirve, sin arriesgar los datos reales. Para hacer
// una restauracion real de emergencia hay que pasar --confirm-production
// a proposito.
//
// Uso:
//   node scripts/restore-mongo.js --from=backups/2026-01-01T00-00-00-000Z
//     -> restaura a una base temporal "ozama_restore_test_<timestamp>"
//        y te dice el nombre para que la revises en Atlas / Compass.
//
//   node scripts/restore-mongo.js --from=backups/... --confirm-production
//     -> restaura DE VERDAD sobre la base de MONGODB_URI (produccion).
//        Pide una confirmacion explicita ademas de la flag.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');
const { assertSafeTestDatabase, uriWithDbName } = require('./test-db-guard');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGODB_URI en tu .env');
    process.exit(1);
  }

  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value === undefined ? true : value];
    })
  );

  const fromDir = args.from ? path.resolve(String(args.from)) : null;
  if (!fromDir || !fs.existsSync(fromDir)) {
    console.error('Pasa --from=<carpeta del backup> (la que genero scripts/backup-mongo.js).');
    process.exit(1);
  }

  const files = fs.readdirSync(fromDir).filter((f) => f.endsWith('.json') && f !== '_meta.json');
  if (!files.length) {
    console.error(`No hay archivos .json de coleccion en ${fromDir}`);
    process.exit(1);
  }

  const confirmProduction = args['confirm-production'] === true;
  let targetUri = uri;
  let targetDbName;

  if (confirmProduction) {
    const answer = await ask(
      '\n⚠️  Vas a restaurar ENCIMA de la base de datos de produccion (MONGODB_URI).\n' +
      'Esto puede pisar/duplicar datos reales. Escribi RESTAURAR para continuar: '
    );
    if (answer.trim().toUpperCase() !== 'RESTAURAR') {
      console.log('Cancelado.');
      process.exit(0);
    }
    targetDbName = process.env.MONGODB_DB_NAME || 'ozama-chess';
  } else {
    targetDbName = `ozama_test_restore_${Date.now()}`;
    targetUri = uriWithDbName(uri, targetDbName);
    assertSafeTestDatabase({ uri: targetUri, dbName: targetDbName });
    console.log(`Modo seguro: restaurando a una base temporal nueva: "${targetDbName}"`);
    console.log('(no toca produccion -- usa --confirm-production si de verdad queres restaurar ahi)\n');
  }

  const client = new MongoClient(targetUri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();

  try {
    const db = client.db(targetDbName);
    let totalDocs = 0;
    for (const file of files) {
      const collectionName = file.replace(/\.json$/, '');
      const raw = fs.readFileSync(path.join(fromDir, file), 'utf8');
      const docs = EJSON.parse(raw);
      if (!Array.isArray(docs) || !docs.length) {
        console.log(`  ${collectionName}: vacio, se salta.`);
        continue;
      }
      await db.collection(collectionName).insertMany(docs, { ordered: false }).catch((err) => {
        console.warn(`  ${collectionName}: algunos documentos no se pudieron insertar (${err.message}) -- probablemente ya existian.`);
      });
      totalDocs += docs.length;
      console.log(`  ${collectionName}: ${docs.length} documentos restaurados.`);
    }
    console.log(`\nListo. ${totalDocs} documentos restaurados en la base "${targetDbName}".`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Error restaurando el backup:', err.message);
  process.exit(1);
});
