'use strict';

// Entrenamiento tactico (Fase 8 del roadmap PRO). Ver services/puzzles.js
// para el catalogo (y como se verifico cada posicion contra el motor
// real antes de entrar aca) y services/achievements.js para el XP y
// los logros que otorga resolver puzzles.
const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { byKey, publicPuzzle, dailyPuzzleForDate, nextPracticePuzzle, solutionMatches } = require('../services/puzzles');
const { xpForPuzzle, levelFromXp, xpIntoLevel, buildContext, checkNewAchievements } = require('../services/achievements');

const router = express.Router();

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

router.get('/daily', optionalAuth, async (req, res) => {
  const today = todayStr();
  const puzzle = dailyPuzzleForDate(today);
  const alreadyDone = !!(req.user && req.user.puzzles?.lastDailyDate === today);
  res.json({ puzzle: publicPuzzle(puzzle), date: today, alreadyDone });
});

router.get('/practice', requireAuth, async (req, res) => {
  const puzzle = nextPracticePuzzle(req.user.puzzles?.solvedKeys);
  res.json({ puzzle: publicPuzzle(puzzle) });
});

router.get('/stats', requireAuth, async (req, res) => {
  const p = req.user.puzzles || {};
  res.json({
    totalSolved: p.totalSolved || 0,
    streak: p.streak || 0,
    bestStreak: p.bestStreak || 0,
    xp: req.user.xp || 0,
    level: levelFromXp(req.user.xp),
    xpIntoLevel: xpIntoLevel(req.user.xp),
  });
});

router.post('/:key/solve', requireAuth, async (req, res) => {
  try {
    const puzzle = byKey(req.params.key);
    if (!puzzle) return res.status(404).json({ error: 'Puzzle no encontrado.' });

    const moves = Array.isArray(req.body?.moves) ? req.body.moves : [];
    const mode = req.body?.mode === 'daily' ? 'daily' : 'practice';
    const correct = solutionMatches(puzzle, moves);
    if (!correct) return res.json({ correct: false });

    const user = req.user;
    user.puzzles = user.puzzles || {};
    user.puzzles.solvedKeys = user.puzzles.solvedKeys || [];

    const today = todayStr();
    const yesterday = todayStr(-1);
    let xpGained = 0;
    let dailyAlreadyDone = false;

    if (mode === 'daily' && user.puzzles.lastDailyDate === today) {
      dailyAlreadyDone = true;
    } else {
      if (mode === 'daily') user.puzzles.lastDailyDate = today;

      const alreadySolvedBefore = user.puzzles.solvedKeys.includes(puzzle.key);
      if (!alreadySolvedBefore) user.puzzles.solvedKeys.push(puzzle.key);
      user.puzzles.totalSolved = Number(user.puzzles.totalSolved || 0) + 1;
      xpGained = xpForPuzzle(puzzle.difficulty);
      user.xp = Number(user.xp || 0) + xpGained;

      // Racha de DIAS consecutivos con al menos un puzzle resuelto
      // (distinta de la racha de victorias en partidas).
      if (user.puzzles.lastSolvedDate !== today) {
        user.puzzles.streak = user.puzzles.lastSolvedDate === yesterday ? Number(user.puzzles.streak || 0) + 1 : 1;
        if (user.puzzles.streak > Number(user.puzzles.bestStreak || 0)) user.puzzles.bestStreak = user.puzzles.streak;
        user.puzzles.lastSolvedDate = today;
      }
    }

    const ctx = buildContext({
      user, game: 'chess', outcome: 'draw', opponentElo: null, moveCount: 0, endedAt: new Date(),
      totalPuzzlesSolved: user.puzzles.totalSolved,
    });
    const newKeys = checkNewAchievements(user, ctx);
    if (newKeys.length) user.achievements = [...(user.achievements || []), ...newKeys.map((key) => ({ key, unlockedAt: new Date() }))];

    await user.save();

    res.json({
      correct: true,
      alreadyCompleted: dailyAlreadyDone,
      xpGained,
      streak: user.puzzles.streak,
      bestStreak: user.puzzles.bestStreak,
      totalSolved: user.puzzles.totalSolved,
      level: levelFromXp(user.xp),
      newAchievements: newKeys,
    });
  } catch (err) {
    console.error('[Puzzles] solve:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
