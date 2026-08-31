'use strict';

// Torneos por defecto (Fase 3, "OZAMA Torneos + Experiencia Visual").
// Idempotente: busca por titulo antes de crear, asi que correrlo dos
// veces no duplica nada -- se puede correr de nuevo sin miedo despues
// de que algunos de estos ya se hayan jugado (crea los que falten).
//
// Recurrencia (Fase 4 del pedido original): el modelo ya tiene el
// campo `recurrence`, pero a proposito NO hay todavia un generador
// automatico que cree la "proxima edicion" solo. Un scheduler en
// proceso (setInterval) no es confiable en Render (el proceso se
// puede reiniciar); el patron que YA usa esta app para contenido
// "diario" (services/puzzles.js: dailyPuzzleForDate) es calcularlo al
// vuelo a partir de la fecha, no crear un documento por dia. Ese
// mismo patron es el candidato natural para torneos recurrentes, pero
// es una pieza de trabajo aparte (decide como se resetean
// inscripciones/bracket) -- se deja para una fase siguiente,
// documentado aca en vez de improvisado a medias.
//
// Uso: node scripts/seed-default-tournaments.js

require('dotenv').config();
const mongoose = require('mongoose');
const Event = require('../models/Event');

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1000);
}

function nextSaturday(hour = 18) {
  const d = new Date();
  const day = d.getUTCDay(); // 0=domingo
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilSat);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

const DEFAULT_TOURNAMENTS = [
  {
    title: 'Blitz OZAMA',
    gameType: 'chess',
    icon: '⚡',
    timeControl: '5+0',
    description: 'El clasico de OZAMA: partidas rapidas, eliminacion directa, sin vueltas.',
    reward: 'Insignia + XP',
    maxPlayers: 32,
    startsAt: hoursFromNow(2),
  },
  {
    title: 'Rapid OZAMA',
    gameType: 'chess',
    icon: '♟',
    timeControl: '10+0',
    description: 'Mas tiempo para pensar cada jugada -- ideal si te gusta jugar con calma.',
    reward: 'Insignia + XP',
    maxPlayers: 32,
    startsAt: hoursFromNow(24),
  },
  {
    title: 'Reto Relampago',
    gameType: 'chess',
    icon: '🔥',
    timeControl: '3+2',
    description: 'Torneo casual, rapido y directo -- perfecto para calentar antes del Blitz.',
    reward: 'XP',
    maxPlayers: 16,
    startsAt: hoursFromNow(6),
  },
  {
    title: 'Fin de Semana OZAMA',
    gameType: 'chess',
    icon: '🏆',
    timeControl: '10+0',
    description: 'El evento semanal de OZAMA -- el torneo mas grande de la semana, con el premio mas grande.',
    reward: 'Marco de Campeón + XP',
    maxPlayers: 64,
    startsAt: nextSaturday(18),
  },
  {
    title: 'Damas Blitz',
    gameType: 'checkers',
    icon: '⚡',
    timeControl: '5+0',
    description: 'Damas a toda velocidad -- eliminacion directa, sin descanso.',
    reward: 'Insignia + XP',
    maxPlayers: 32,
    startsAt: hoursFromNow(3),
  },
  {
    title: 'Damas Rapid',
    gameType: 'checkers',
    icon: '⚫',
    timeControl: '10+0',
    description: 'Damas con mas tiempo para calcular cada captura.',
    reward: 'Insignia + XP',
    maxPlayers: 32,
    startsAt: hoursFromNow(24),
  },
  {
    title: 'Desafio OZAMA',
    gameType: 'checkers',
    icon: '🎯',
    timeControl: '5+2',
    description: 'Torneo casual de Damas -- ideal para probarte contra otros jugadores de la comunidad.',
    reward: 'XP',
    maxPlayers: 16,
    startsAt: hoursFromNow(8),
  },
  {
    title: 'Gran Torneo de Damas',
    gameType: 'checkers',
    icon: '👑',
    timeControl: '10+0',
    description: 'El evento semanal de Damas -- el torneo mas grande de la semana, con el premio mas grande.',
    reward: 'Marco de Campeón + XP',
    maxPlayers: 64,
    startsAt: nextSaturday(20),
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || 'ozama-chess' });
  console.log('Conectado a MongoDB.');

  let created = 0, skipped = 0;
  for (const def of DEFAULT_TOURNAMENTS) {
    const exists = await Event.findOne({ title: def.title, type: 'tournament' }).select('_id status');
    if (exists) {
      console.log(`SKIP (ya existe, status=${exists.status}): ${def.title}`);
      skipped++;
      continue;
    }
    await Event.create({
      title: def.title,
      type: 'tournament',
      status: 'published',
      gameType: def.gameType,
      description: def.description,
      startsAt: def.startsAt,
      endsAt: null,
      maxPlayers: def.maxPlayers,
      format: 'elimination',
      timeControl: def.timeControl,
      reward: def.reward,
      icon: def.icon,
      recurrence: 'none',
      participants: [],
    });
    console.log(`CREADO: ${def.title} (${def.gameType}, ${def.timeControl}) -- empieza ${def.startsAt.toISOString()}`);
    created++;
  }

  console.log(`\nListo. Creados: ${created}, ya existian: ${skipped}.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error('ERROR:', err); process.exit(1); });
