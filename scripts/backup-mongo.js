'use strict';

// Vuelca todas las colecciones de MongoDB a archivos JSON (formato
// EJSON, que preserva ObjectId/Date correctamente) para tener un
// respaldo restaurable si algo le pasa a la base de datos real.
//
// No usa mongodump/mongorestore (no vienen instalados en este
// entorno) -- se conecta directo con el driver de Mongo y lee cada
// coleccion completa. Para una base chica como esta, es mas que
// suficiente.
//
// Uso local:
//   node scripts/backup-mongo.js
//   node scripts/backup-mongo.js --out=mi-carpeta
//
// En CI (ver .github/workflows/backup-mongo.yml) corre solo, todos
// los dias, usando el secret MONGODB_URI del repo -- el resultado
// queda como "artifact" descargable desde la pestana Actions de
// GitHub, sin costo y sin tocar Render.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('Falta MONGODB_URI (en tu .env local, o como secret en GitHub Actions).');
    process.exit(1);
  }
  const dbName = process.env.MONGODB_DB_NAME || 'ozama-chess';

  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, value] = arg.replace(/^--/, '').split('=');
      return [key, value === undefined ? true : value];
    })
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(String(args.out || `backups/${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Conectando a MongoDB (db: ${dbName})...`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();

  try {
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    if (!collections.length) {
      console.warn('No se encontraron colecciones -- revisa MONGODB_DB_NAME.');
    }

    let totalDocs = 0;
    for (const { name } of collections) {
      const docs = await db.collection(name).find({}).toArray();
      const filePath = path.join(outDir, `${name}.json`);
      fs.writeFileSync(filePath, EJSON.stringify(docs, null, 2));
      totalDocs += docs.length;
      console.log(`  ${name}: ${docs.length} documentos -> ${path.relative(process.cwd(), filePath)}`);
    }

    fs.writeFileSync(
      path.join(outDir, '_meta.json'),
      JSON.stringify({ dbName, createdAt: new Date().toISOString(), collections: collections.map((c) => c.name), totalDocs }, null, 2)
    );

    console.log(`\nListo. Backup en: ${outDir}`);
    console.log(`Total: ${collections.length} colecciones, ${totalDocs} documentos.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Error haciendo el backup:', err.message);
  process.exit(1);
});
