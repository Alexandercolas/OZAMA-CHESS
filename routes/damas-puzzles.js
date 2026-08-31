'use strict';

// Entrenamiento tactico de Damas (Fase 10 del roadmap multijuego).
// Espejo de routes/puzzles.js (ajedrez) -- mismo diseno (desafio del
// dia deterministico, cola de practica por dificultad, XP compartido,
// racha propia de Damas) pero usando el catalogo de
// services/damas-puzzles.js y el campo User.damasPuzzles.
const express = require('express');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { byKey, publicPuzzle, dailyPuzzleForDate, nextPracticePuzzle, solutionMatches } = require('../services/damas-puzzles');
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
  const alreadyDone = !!(req.user && req.user.damasPuzzles?.lastDailyDate === today);
  res.json({ puzzle: publicPuzzle(puzzle), date: today, alreadyDone });
});

router.get('/practice', requireAuth, async (req, res) => {
  const puzzle = nextPracticePuzzle(req.user.damasPuzzles?.solvedKeys);
  res.json({ puzzle: publicPuzzle(puzzle) });
});

router.get('/stats', requireAuth, async (req, res) => {
  const p = req.user.damasPuzzles || {};
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
    user.damasPuzzles = user.damasPuzzles || {};
    user.damasPuzzles.solvedKeys = user.damasPuzzles.solvedKeys || [];

    const today = todayStr();
    const yesterday = todayStr(-1);
    let xpGained = 0;
    let dailyAlreadyDone = false;

    if (mode === 'daily' && user.damasPuzzles.lastDailyDate === today) {
      dailyAlreadyDone = true;
    } else {
      if (mode === 'daily') user.damasPuzzles.lastDailyDate = today;

      const alreadySolvedBefore = user.damasPuzzles.solvedKeys.includes(puzzle.key);
      if (!alreadySolvedBefore) user.damasPuzzles.solvedKeys.push(puzzle.key);
      user.damasPuzzles.totalSolved = Number(user.damasPuzzles.totalSolved || 0) + 1;
      xpGained = xpForPuzzle(puzzle.difficulty);
      user.xp = Number(user.xp || 0) + xpGained;

      if (user.damasPuzzles.lastSolvedDate !== today) {
        user.damasPuzzles.streak = user.damasPuzzles.lastSolvedDate === yesterday ? Number(user.damasPuzzles.streak || 0) + 1 : 1;
        if (user.damasPuzzles.streak > Number(user.damasPuzzles.bestStreak || 0)) user.damasPuzzles.bestStreak = user.damasPuzzles.streak;
        user.damasPuzzles.lastSolvedDate = today;
      }
    }

    const totalPuzzlesSolved = Number(user.puzzles?.totalSolved || 0) + Number(user.damasPuzzles.totalSolved || 0);
    const ctx = buildContext({
      user, game: 'damas', outcome: 'draw', opponentElo: null, moveCount: 0, endedAt: new Date(),
      totalPuzzlesSolved,
    });
    const newKeys = checkNewAchievements(user, ctx);
    if (newKeys.length) user.achievements = [...(user.achievements || []), ...newKeys.map((key) => ({ key, unlockedAt: new Date() }))];

    await user.save();

    res.json({
      correct: true,
      alreadyCompleted: dailyAlreadyDone,
      xpGained,
      streak: user.damasPuzzles.streak,
      bestStreak: user.damasPuzzles.bestStreak,
      totalSolved: user.damasPuzzles.totalSolved,
      level: levelFromXp(user.xp),
      newAchievements: newKeys,
    });
  } catch (err) {
    console.error('[DamasPuzzles] solve:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
