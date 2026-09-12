'use strict';

// Otorgar un logro + bono de XP (movido aca desde server.js al sumar
// las recompensas de fin de temporada, Fase 1 del roadmap "OZAMA PRO -
// FASE FINAL": tanto los premios de torneo (server.js) como los de
// temporada (services/seasons.js) necesitan exactamente lo mismo --
// un solo lugar en vez de duplicarlo.
const User = require('../models/User');

async function grantAchievementReward(userId, achievementKey, xpBonus) {
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
  } catch (err) {
    console.warn(`[Rewards] No se pudo otorgar ${achievementKey}:`, err.message);
  }
}

module.exports = { grantAchievementReward };
