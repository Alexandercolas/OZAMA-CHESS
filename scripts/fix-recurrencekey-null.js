'use strict';

// Migracion segura y puntual (Fase 3, Torneos PRO): antes de esta
// fase, models/Event.js tenia `recurrenceKey: { type: String, default:
// null }` -- Mongoose escribia el campo EXPLICITAMENTE en null para
// cualquier torneo creado a mano (no recurrente), y un indice sparse-
// unique SI considera ese null como un valor indexado (no lo trata
// como "campo ausente"), asi que el SEGUNDO torneo manual creado
// siempre chocaba con "E11000 duplicate key... recurrenceKey: null".
//
// Esta migracion solo hace $unset del campo en los documentos donde
// vale null explicito -- no toca nada mas, no borra ningun evento, y
// los documentos con un recurrenceKey real (los recurrentes: "blitz-
// diario-...", etc) quedan intactos.
//
// Por defecto, dry-run (solo cuenta cuantos documentos afectaria).
// Uso:
//   node scripts/fix-recurrencekey-null.js            (dry-run)
//   node scripts/fix-recurrencekey-null.js --confirm   (aplica de verdad)

require('dotenv').config();
const mongoose = require('mongoose');
const connectDatabase = require('../config/database');
const Event = require('../models/Event');

async function main() {
  const confirm = process.argv.includes('--confirm');
  await connectDatabase();
  console.log(`[fix] Conectado a la base: ${mongoose.connection.name}`);

  const affected = await Event.find({ recurrenceKey: null }).select('_id title type recurrenceKey').lean();
  console.log(`[fix] ${affected.length} evento(s) con recurrenceKey: null encontrados:`);
  for (const e of affected) console.log(`  - ${e._id} "${e.title}" (${e.type})`);

  if (!affected.length) {
    console.log('[fix] Nada que corregir.');
  } else if (!confirm) {
    console.log('\n[fix] Esto fue solo una vista previa (dry-run). Nada se modifico.');
    console.log('[fix] Vuelve a correr con --confirm para aplicar el $unset de verdad:');
    console.log('  node scripts/fix-recurrencekey-null.js --confirm');
  } else {
    const result = await Event.updateMany({ recurrenceKey: null }, { $unset: { recurrenceKey: '' } });
    console.log(`[fix] Corregidos ${result.modifiedCount} evento(s).`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[fix] Error:', err.message);
  process.exit(1);
});
