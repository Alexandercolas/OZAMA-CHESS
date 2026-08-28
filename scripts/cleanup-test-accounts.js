'use strict';

// Borra cuentas de prueba que quedaron en la base de datos real (las
// que crea scripts/dynamic-security-check.js: secA/B/C/D_#########
// y xss_#########, todas con correo @example.test). El script en si
// esta pensado para correr contra una base aislada y temporal, asi
// que si ves estas cuentas en produccion es porque alguna vez se corrio
// algo similar apuntando directo al servidor real.
//
// Por seguridad, por defecto solo LISTA lo que encontraria (dry-run).
// Para borrar de verdad hay que pasar --confirm explicitamente.
//
// Uso:
//   node scripts/cleanup-test-accounts.js            (solo muestra que borraria)
//   node scripts/cleanup-test-accounts.js --confirm  (borra de verdad)
//
// Usa el MONGODB_URI de tu .env -- si ese .env apunta a produccion,
// esto corre contra produccion. Revisa la lista del dry-run con calma
// antes de confirmar.

require('dotenv').config();

const mongoose = require('mongoose');
const connectDatabase = require('../config/database');
const User = require('../models/User');

const TEST_PATTERNS = [
  { field: 'email', regex: /@example\.test$/i },
  { field: 'username', regex: /^sec[A-D]_\d+$/i },
  { field: 'username', regex: /^xss_\d+$/i },
];

async function main() {
  const confirm = process.argv.includes('--confirm');

  await connectDatabase();
  console.log(`[cleanup] Conectado a la base: ${mongoose.connection.name}`);

  const query = {
    $or: TEST_PATTERNS.map(({ field, regex }) => ({ [field]: regex })),
  };

  const matches = await User.find(query).select('username email createdAt').lean();

  if (!matches.length) {
    console.log('[cleanup] No se encontraron cuentas de prueba. Nada que hacer.');
    await mongoose.disconnect();
    return;
  }

  console.log(`[cleanup] ${matches.length} cuenta(s) de prueba encontradas:`);
  for (const user of matches) {
    console.log(`  - ${user.username} <${user.email}> creada ${user.createdAt?.toISOString?.() || 'fecha desconocida'}`);
  }

  if (!confirm) {
    console.log('\n[cleanup] Esto fue solo una vista previa (dry-run). Nada se borro.');
    console.log('[cleanup] Vuelve a correr con --confirm para borrarlas de verdad:');
    console.log('  node scripts/cleanup-test-accounts.js --confirm');
    await mongoose.disconnect();
    return;
  }

  const ids = matches.map((user) => user._id);
  const result = await User.deleteMany({ _id: { $in: ids } });
  console.log(`\n[cleanup] Borradas ${result.deletedCount} cuenta(s) de prueba.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[cleanup] Error:', err.message);
  process.exitCode = 1;
});
