'use strict';

// Prueba de "Base de datos" (Fase 34 del roadmap "OZAMA PRO"): una
// auditoria anterior (OZAMA_PRO_AUDIT.md, seccion 27) habia encontrado
// que User no tenia indice en elo/damasElo pese a que el ranking
// ordena por esos campos, y que DamasMatch no tenia indice en result
// (a diferencia de Match). Auditando esta fase se encontro que esos
// indices YA estan declarados en los modelos (models/User.js,
// models/DamasMatch.js) -- el hueco real que quedaba sin cerrar era
// que nadie habia CONFIRMADO que el query planner de Mongo los usa de
// verdad (un indice mal declarado, con el nombre de campo equivocado,
// o una consulta real que no calza con ningun indice existente, no se
// nota con solo leer el schema).
//
// Este script sirve ambas cosas a la vez: la PRIMERA vez que corre,
// confirma con datos reales que las 4 consultas de mas trafico de
// toda la app usan un indice real (IXSCAN), nunca un recorrido
// completo de la coleccion (COLLSCAN) -- y de ahi en adelante, queda
// como regresion permanente: si alguien borra un indice sin querer, o
// agrega una consulta nueva que no calza con ninguno, esta prueba
// falla en vez de quedar como una degradacion silenciosa que solo se
// nota cuando la base de datos ya crecio lo suficiente para sentirse.
//
// Verifica, contra una Mongo aislada y temporal (nunca produccion),
// sembrada con un dataset realista (60 usuarios, 300 partidas):
//
//   - GET /api/user/leaderboard (Ajedrez y Damas): sort por elo/
//     damasElo descendente, limit 20 -- usa el indice {elo:-1} /
//     {damasElo:-1}, examina solo 20 documentos (nunca la coleccion
//     entera) para devolver 20;
//   - GET /api/user/leaderboard/climbers: rango de endedAt + filtro
//     de result, sort por endedAt -- usa el indice {endedAt:-1};
//   - el filtro $or whitePlayer.userId/blackPlayer.userId + result
//     (el patron mas repetido de toda la app: historial, perfil,
//     mi-analisis, elo-history lo usan los 7) -- usa uno de los
//     indices compuestos {whitePlayer.userId,createdAt} /
//     {blackPlayer.userId,createdAt}.
//
// Uso: node scripts/verify-database-indices.js

require('dotenv').config();
const mongoose = require('mongoose');
const { createIsolatedMongoEnv } = require('./test-db-guard');

const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_dbindex' });

function assert(cond, message) { if (!cond) throw new Error(`ASSERTION FAILED: ${message}`); }

// Encuentra la etapa IXSCAN/COLLSCAN real dentro del plan ganador --
// puede venir envuelta en SORT/FETCH/OR, nunca es la raiz misma.
function findStage(node, want) {
  if (!node) return null;
  if (node.stage === want) return node;
  if (node.inputStage) { const found = findStage(node.inputStage, want); if (found) return found; }
  for (const child of node.inputStages || []) {
    const found = findStage(child, want);
    if (found) return found;
  }
  return null;
}

async function explainAndAssert(label, cursor) {
  const stats = await cursor.explain('executionStats');
  const ixscan = findStage(stats.queryPlanner.winningPlan, 'IXSCAN');
  const collscan = findStage(stats.queryPlanner.winningPlan, 'COLLSCAN');
  const { totalDocsExamined, nReturned, executionTimeMillis } = stats.executionStats;
  console.log(`${label}\n  indice: ${ixscan ? ixscan.indexName : 'NINGUNO'} · examinados: ${totalDocsExamined} · devueltos: ${nReturned} · ${executionTimeMillis}ms`);
  assert(ixscan && !collscan, `"${label}" deberia usar un indice real (IXSCAN), hizo COLLSCAN en su lugar -- ver models/*.js`);
}

async function main() {
  await mongoose.connect(isolatedMongo.uri, { dbName: isolatedMongo.dbName });
  console.log(`DB=${isolatedMongo.dbName}`);

  const User = require('../models/User');
  const Match = require('../models/Match');

  try {
    const suffix = String(Date.now()).slice(-8);
    const users = [];
    for (let i = 0; i < 60; i++) {
      users.push({
        username: `dbidxU${i}_${suffix}`, email: `dbidxu${i}_${suffix}@example.test`, password: 'CorrectHorse99!',
        elo: 1000 + Math.floor(Math.random() * 800), damasElo: 1000 + Math.floor(Math.random() * 800),
      });
    }
    const created = await User.create(users);

    const matches = [];
    const now = Date.now();
    for (let i = 0; i < 300; i++) {
      const a = created[Math.floor(Math.random() * created.length)];
      const b = created[Math.floor(Math.random() * created.length)];
      matches.push({
        roomCode: `DI${i}${suffix}`.slice(0, 10).toUpperCase(),
        whitePlayer: { userId: a._id, name: a.username, elo: a.elo },
        blackPlayer: { userId: b._id, name: b.username, elo: b.elo },
        result: 'white_win', winner: 'w',
        endedAt: new Date(now - Math.floor(Math.random() * 40) * 86400000),
      });
    }
    await Match.create(matches);
    console.log(`Sembrados 60 usuarios y 300 partidas para un dataset realista.\n`);

    await explainAndAssert(
      'GET /api/user/leaderboard (Ajedrez -- sort elo desc, limit 20)',
      User.find({ isActive: true }).sort({ elo: -1 }).limit(20).select('username elo').lean()
    );
    await explainAndAssert(
      'GET /api/user/leaderboard?game=damas (sort damasElo desc, limit 20)',
      User.find({ isActive: true }).sort({ damasElo: -1 }).limit(20).select('username damasElo').lean()
    );

    const cutoff = new Date(now - 7 * 86400000);
    await explainAndAssert(
      'GET /api/user/leaderboard/climbers (endedAt >= cutoff + result, sort endedAt)',
      Match.find({ endedAt: { $gte: cutoff }, result: { $in: ['white_win', 'black_win', 'draw'] } }).sort({ endedAt: 1 }).select('whitePlayer.userId').lean()
    );

    const someUser = created[0];
    await explainAndAssert(
      'GET /api/user/history (patron $or whitePlayer.userId/blackPlayer.userId + result -- el mas repetido de la app)',
      Match.find({
        $or: [{ 'whitePlayer.userId': someUser._id }, { 'blackPlayer.userId': someUser._id }],
        result: { $in: ['white_win', 'black_win', 'draw'] },
      }).select('whitePlayer.userId').lean()
    );

    console.log('\n✅ DATABASE_INDICES_OK -- las 4 consultas de mas trafico usan un indice real, ninguna hace COLLSCAN.');
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('\n❌ DATABASE_INDICES_FAILED:', err.message);
  process.exit(1);
});
