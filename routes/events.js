'use strict';

const express = require('express');
const Event = require('../models/Event');
const { requireAuth, optionalAuth } = require('../middleware/auth');

const router = express.Router();

function validObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ''));
}

router.get('/', async (_req, res) => {
  try {
    const events = await Event.find({ status: { $in: ['published', 'active'] } })
      .sort({ startsAt: 1, createdAt: -1 })
      .limit(20)
      .select('title type description startsAt endsAt maxPlayers participants createdAt')
      .lean();

    res.json({ events: events.map((e) => ({ ...e, participantCount: (e.participants || []).length, participants: undefined })) });
  } catch (err) {
    console.error('[Events] Public feed:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

// Busca, dentro del bracket, el partido pendiente/en curso donde el
// usuario es uno de los dos jugadores -- eso es lo que la pagina de
// torneos necesita para mostrar "Jugar mi partida".
function findYourMatch(bracket, userId) {
  if (!bracket?.rounds?.length || !userId) return null;
  for (let r = 0; r < bracket.rounds.length; r++) {
    const matches = bracket.rounds[r].matches || [];
    for (let m = 0; m < matches.length; m++) {
      const match = matches[m];
      const isPlayer = String(match.player1) === String(userId) || String(match.player2) === String(userId);
      if (isPlayer && (match.status === 'ready' || match.status === 'playing')) {
        return {
          round: r,
          matchIndex: m,
          roomCode: match.roomCode || null,
          opponentName: String(match.player1) === String(userId) ? match.player2Name : match.player1Name,
          color: String(match.player1) === String(userId) ? 'w' : 'b',
        };
      }
    }
  }
  return null;
}

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });
    const event = await Event.findById(req.params.id)
      .populate('participants', 'username country elo avatarImage avatar')
      .lean();
    if (!event || !['published', 'active', 'finished'].includes(event.status)) {
      return res.status(404).json({ error: 'Evento no encontrado.' });
    }

    const userId = req.user?._id;
    const youJoined = !!userId && (event.participants || []).some((p) => String(p._id) === String(userId));
    const canJoin = event.type === 'tournament'
      && ['draft', 'published'].includes(event.status)
      && !youJoined
      && (event.participants || []).length < (event.maxPlayers || 16);
    const yourMatch = findYourMatch(event.bracket, userId);

    res.json({ event, youJoined, canJoin, yourMatch });
  } catch (err) {
    console.error('[Events] Detail:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    if (event.type !== 'tournament') return res.status(400).json({ error: 'Este evento no acepta inscripcion.' });
    if (!['draft', 'published'].includes(event.status)) {
      return res.status(400).json({ error: 'Este torneo ya no acepta inscripciones.' });
    }
    if (event.participants.some((p) => String(p) === String(req.user._id))) {
      return res.status(400).json({ error: 'Ya estas inscrito.' });
    }
    if (event.participants.length >= (event.maxPlayers || 16)) {
      return res.status(400).json({ error: 'El torneo ya esta lleno.' });
    }
    event.participants.push(req.user._id);
    await event.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Events] Join:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

router.post('/:id/leave', requireAuth, async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json({ error: 'Evento invalido.' });
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });
    if (!['draft', 'published'].includes(event.status)) {
      return res.status(400).json({ error: 'El torneo ya empezo, no podes salir desde aca.' });
    }
    event.participants = event.participants.filter((p) => String(p) !== String(req.user._id));
    await event.save({ validateModifiedOnly: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Events] Leave:', err.message);
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});

module.exports = router;
