'use strict';

// Explorador de aperturas (Fase 9 del roadmap PRO). Publico a
// proposito -- es contenido educativo, no hace falta cuenta para
// consultarlo. Ver services/openings.js para el catalogo (compartido
// con la deteccion de apertura que ya usan las estadisticas
// avanzadas, para no mantener dos listas separadas).
const express = require('express');
const { listOpenings } = require('../services/openings');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ openings: listOpenings() });
});

module.exports = router;
