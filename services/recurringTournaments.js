'use strict';

// Torneos recurrentes (Fase 9-10, "OZAMA PRO / Experiencia Final").
// Mismo principio que el puzzle diario (services/puzzles.js:
// dailyPuzzleForDate): la "edicion actual" se CALCULA a partir de la
// fecha, nunca la crea un cron de antemano -- un proceso en Render
// puede reiniciarse en cualquier momento, asi que no hay garantia de
// que un setInterval llegue a dispararse. En cambio, cada vez que se
// pide la lista publica de torneos (GET /api/events) se asegura que
// la edicion de HOY/esta semana/este mes ya exista en la base
// (findOneAndUpdate con upsert, idempotente -- correrlo de nuevo no
// duplica nada, el indice unico en recurrenceKey lo garantiza).
const Event = require('../models/Event');

const MS_PER_DAY = 86400000;

// Solo 4 plantillas para este primer corte -- 2 de Ajedrez, 2 de
// Damas, una diaria y una semanal cada una. Mas se pueden sumar
// despues agregando una entrada aca, sin tocar el resto del sistema.
const RECURRING_TEMPLATES = [
  {
    key: 'blitz-diario',
    title: 'Blitz Diario',
    gameType: 'chess',
    cadence: 'daily',
    icon: '⚡',
    timeControl: '3+0',
    description: 'La edicion de hoy del Blitz de OZAMA -- eliminacion directa, mañana hay otra.',
    reward: 'Insignia + XP',
    maxPlayers: 16,
    startHourUTC: 22,
  },
  {
    key: 'copa-ozama',
    title: 'Copa OZAMA',
    gameType: 'chess',
    cadence: 'weekly',
    icon: '🏆',
    timeControl: '10+0',
    description: 'El torneo semanal de Ajedrez de OZAMA -- una nueva copa cada semana.',
    reward: 'Marco de Campeón + XP',
    maxPlayers: 32,
    weekday: 6, // sabado (0=domingo en getUTCDay)
    startHourUTC: 19,
  },
  {
    key: 'damas-diario',
    title: 'Damas del Dia',
    gameType: 'checkers',
    cadence: 'daily',
    icon: '⚡',
    timeControl: '3+0',
    description: 'La edicion de hoy de Damas -- eliminacion directa, mañana hay otra.',
    reward: 'Insignia + XP',
    maxPlayers: 16,
    startHourUTC: 23,
  },
  {
    key: 'copa-damas',
    title: 'Copa OZAMA de Damas',
    gameType: 'checkers',
    cadence: 'weekly',
    icon: '👑',
    timeControl: '10+0',
    description: 'El torneo semanal de Damas de OZAMA -- una nueva copa cada semana.',
    reward: 'Marco de Campeón + XP',
    maxPlayers: 32,
    weekday: 0, // domingo
    startHourUTC: 19,
  },
];

function pad(n) { return String(n).padStart(2, '0'); }

// Identificador deterministico de la edicion actual -- mismo dia/
// semana/mes siempre da la misma clave, sin importar cuantas veces se
// calcule ni desde que proceso.
function editionKeyFor(template, now) {
  if (template.cadence === 'daily') {
    return `${template.key}-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  }
  if (template.cadence === 'weekly') {
    // Semana ISO simplificada: dias desde un lunes fijo de referencia,
    // dividido 7 -- alcanza para agrupar "la misma semana" de forma
    // estable, no hace falta el calculo ISO completo para esto.
    const refMonday = new Date(Date.UTC(2026, 0, 5)); // lunes 5 ene 2026
    const weekIndex = Math.floor((now - refMonday) / (7 * MS_PER_DAY));
    return `${template.key}-w${weekIndex}`;
  }
  if (template.cadence === 'monthly') {
    return `${template.key}-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  }
  return `${template.key}-${now.getTime()}`;
}

// Proxima fecha/hora de inicio de la edicion actual.
function editionStartsAtFor(template, now) {
  if (template.cadence === 'daily') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), template.startHourUTC || 20));
  }
  if (template.cadence === 'weekly') {
    const day = now.getUTCDay();
    const target = template.weekday ?? 6;
    let diff = target - day;
    if (diff < 0) diff += 7;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff, template.startHourUTC || 19));
    // Si ya paso la hora de esta semana, la "edicion actual" ya arranco
    // -- el startsAt queda en el pasado (el torneo ya esta "abierto"),
    // que es el comportamiento correcto, no un bug.
    return d;
  }
  if (template.cadence === 'monthly') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, template.startHourUTC || 19));
  }
  return now;
}

// Asegura que la edicion actual de cada plantilla exista en la base.
// $setOnInsert: si el documento YA existe (alguien mas lo creo un
// instante antes, o ya tiene inscritos/bracket en curso), esta
// llamada no le toca nada -- upsert solo crea, nunca pisa.
async function ensureCurrentEditions(now = new Date()) {
  const results = [];
  for (const template of RECURRING_TEMPLATES) {
    const recurrenceKey = editionKeyFor(template, now);
    try {
      const updated = await Event.findOneAndUpdate(
        { recurrenceKey },
        {
          $setOnInsert: {
            title: template.title,
            type: 'tournament',
            status: 'published',
            gameType: template.gameType,
            description: template.description,
            startsAt: editionStartsAtFor(template, now),
            endsAt: null,
            maxPlayers: template.maxPlayers,
            format: 'elimination',
            timeControl: template.timeControl,
            reward: template.reward,
            icon: template.icon,
            recurrence: template.cadence,
            recurrenceKey,
            participants: [],
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      results.push(updated);
    } catch (err) {
      // Carrera entre dos requests casi simultaneas: el indice unico
      // rechaza el segundo insert, pero el primero ya lo creo -- no es
      // un error real, solo se loguea si es otra cosa.
      if (err.code !== 11000) console.warn('[RecurringTournaments] No se pudo asegurar', template.key, err.message);
    }
  }
  return results;
}

module.exports = { RECURRING_TEMPLATES, editionKeyFor, editionStartsAtFor, ensureCurrentEditions };
