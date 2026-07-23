'use strict';

const express = require('express');
const Event = require('../models/Event');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const events = await Event.find({ status: 'published' })
      .sort({ startsAt: 1, createdAt: -1 })
      .limit(20)
      .select('title type description startsAt endsAt maxPlayers createdAt')
      .lean();

    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
