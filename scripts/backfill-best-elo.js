'use strict';

// Backfill puntual (Fase 5, "Perfil Competitivo"): antes de esta fase
// User.stats.bestElo/damasStats.bestElo no existia -- models/User.js
// ahora lo actualiza solo en cada updateElo()/updateDamasElo() (el
// unico lugar que ya cambia el ELO), pero eso no reconstruye el
// HISTORICO de nadie que ya jugo partidas antes de este cambio. Este
// script recorre las partidas ya guardadas de cada usuario y calcula
// su pico real de ELO de siempre, sin trackear nada nuevo por
// partida -- mismo principio que /api/user/leaderboard/climbers.
//
// Por defecto, dry-run (solo cuenta cuantos usuarios cambiarian).
// Uso:
//   node scripts/backfill-best-elo.js            (dry-run)
//   node scripts/backfill-best-elo.js --confirm   (aplica de verdad)

require('dotenv').config();
const mongoose = require('mongoose');
const connectDatabase = require('../config/database');
const User = require('../models/User');
const Match = require('../models/Match');
const DamasMatch = require('../models/DamasMatch');

// Ajedrez guarda el ELO YA actualizado en el snapshot de la partida;
// Damas guarda el de ANTES (+ eloChange para llegar al de despues) --
// mismo detalle ya documentado en leaderboard/climbers y elo-history.
async function peakEloFrom(Model, isChess) {
  const matches = await Model.find({ result: { $in: ['white_win', 'black_win', 'draw'] } })
    .select('whitePlayer.userId whitePlayer.elo blackPlayer.userId blackPlayer.elo eloChange')
    .lean();

  const peak = new Map(); // userId -> mejor ELO visto en sus propias partidas
  for (const m of matches) {
    for (const side of ['white', 'black']) {
      const player = m[`${side}Player`];
      const uid = player?.userId ? String(player.userId) : null;
      if (!uid) continue;
      const snapshotElo = Number(player.elo || 0);
      const change = Number(m.eloChange?.[side] || 0);
      const eloAfter = isChess ? snapshotElo : snapshotElo + change;
      if (!peak.has(uid) || eloAfter > peak.get(uid)) peak.set(uid, eloAfter);
    }
  }
  return peak;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  await connectDatabase();
  console.log(`[backfill] Conectado a la base: ${mongoose.connection.name}`);

  const [chessPeak, damasPeak] = await Promise.all([
    peakEloFrom(Match, true),
    peakEloFrom(DamasMatch, false),
  ]);

  const users = await User.find({}).select('username elo damasElo stats.bestElo damasStats.bestElo');
  console.log(`[backfill] ${users.length} usuario(s) en total.`);

  let changed = 0;
  for (const u of users) {
    const id = String(u._id);
    // El piso es el ELO EN VIVO de hoy (nunca deberia bajar el pico por
    // debajo de donde esta parado ahora mismo), el techo es lo mas alto
    // visto en su historial de partidas guardadas.
    const chessBest = Math.max(u.elo, chessPeak.get(id) || 0);
    const damasBest = Math.max(u.damasElo, damasPeak.get(id) || 0);

    const needsChess = chessBest > Number(u.stats?.bestElo || 0);
    const needsDamas = damasBest > Number(u.damasStats?.bestElo || 0);
    if (!needsChess && !needsDamas) continue;

    changed++;
    console.log(`  - ${u.username}: ajedrez ${u.stats?.bestElo || 0} -> ${needsChess ? chessBest : u.stats?.bestElo || 0}${needsDamas ? `, damas ${u.damasStats?.bestElo || 0} -> ${damasBest}` : ''}`);
    if (confirm) {
      if (needsChess) u.stats.bestElo = chessBest;
      if (needsDamas) u.damasStats.bestElo = damasBest;
      await u.save({ validateModifiedOnly: true });
    }
  }

  console.log(`\n[backfill] ${changed} usuario(s) ${confirm ? 'actualizados' : 'a actualizar'}.`);
  if (!confirm && changed) {
    console.log('[backfill] Esto fue solo una vista previa (dry-run). Vuelve a correr con --confirm para aplicar de verdad:');
    console.log('  node scripts/backfill-best-elo.js --confirm');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[backfill] Error:', err.message);
  process.exit(1);
});
