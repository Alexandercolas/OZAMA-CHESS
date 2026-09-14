'use strict';

// Otorgar un logro + bono de XP (movido aca desde server.js al sumar
// las recompensas de fin de temporada, Fase 1 del roadmap "OZAMA PRO -
// FASE FINAL": tanto los premios de torneo (server.js) como los de
// temporada (services/seasons.js) necesitan exactamente lo mismo --
// un solo lugar en vez de duplicarlo.
const User = require('../models/User');
const { ACHIEVEMENT_MAP } = require('./achievements');
const { notify } = require('./notifications');

// `io` es opcional a proposito (Fase 8, centro de notificaciones):
// los llamados desde server.js (premios de torneo) lo pasan porque ya
// lo tienen a mano; los de services/seasons.js (premios de fin de
// temporada) NO lo pasan -- esa cadena es de lectura perezosa
// (getActiveSeason/seasonProgressFor, disparada por CUALQUIER request
// que lea el perfil de CUALQUIER usuario) y enhebrar `io` por todos
// esos llamadores intermedios solo para un evento que pasa una vez
// cada ~90 dias no valia la complejidad. Sin `io`, notify() no manda
// nada -- el logro/XP se otorga igual, solo queda sin notificacion en
// vivo por ahora.
async function grantAchievementReward(userId, achievementKey, xpBonus, io = null) {
  if (!userId) return;
  try {
    const user = await User.findById(userId).select('achievements xp');
    if (!user) return;
    const already = (user.achievements || []).some((a) => a.key === achievementKey);
    if (!already) {
      user.achievements = [...(user.achievements || []), { key: achievementKey, unlockedAt: new Date() }];
    }
    if (xpBonus) user.xp = Number(user.xp || 0) + xpBonus;
    await user.save();
    if (!already && io) {
      const def = ACHIEVEMENT_MAP.get(achievementKey);
      if (def) notify(io, userId, { type: 'recompensa', icon: def.icon || '🎁', title: `Recompensa: ${def.name}`, link: '/profile.html' });
    }
  } catch (err) {
    console.warn(`[Rewards] No se pudo otorgar ${achievementKey}:`, err.message);
  }
}

module.exports = { grantAchievementReward };
