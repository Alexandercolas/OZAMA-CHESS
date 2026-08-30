'use strict';

// Compartir partida (Fase 6 del roadmap PRO). Publico a proposito --
// para que un link de "Compartir" funcione sin que quien lo reciba
// tenga que iniciar sesion -- pero con una seleccion de campos muy
// acotada: nunca expone userId, email, ni nada mas alla de lo que ya
// se ve jugando la partida.
const express = require('express');
const Match = require('../models/Match');

const router = express.Router();

function validObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ''));
}

function publicPlayer(p) {
  return { name: p?.name || 'Jugador', country: p?.country || 'DO', avatar: p?.avatar || 0, avatarImage: p?.avatarImage || '' };
}

router.get('/:id/public', async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Partida invalida.' });
    const match = await Match.findById(req.params.id)
      .select('whitePlayer blackPlayer result winner pgn moves startedAt endedAt eloChange')
      .lean();
    if (!match || match.result === 'in_progress') return res.status(404).json({ error: 'Partida no encontrada.' });

    res.json({
      match: {
        white: publicPlayer(match.whitePlayer),
        black: publicPlayer(match.blackPlayer),
        result: match.result,
        winner: match.winner || null,
        pgn: match.pgn || '',
        movesCount: Array.isArray(match.moves) ? match.moves.length : 0,
        eloChange: match.eloChange || { white: null, black: null },
        startedAt: match.startedAt,
        endedAt: match.endedAt,
      },
    });
  } catch (err) {
    console.error('[Matches] public:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
