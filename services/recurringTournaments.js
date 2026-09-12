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

// ── Auto-inicio de torneos (Fase 3, Torneos PRO) ──────────────────
// Antes de esta fase, NINGUN torneo arrancaba solo -- ni siquiera los
// "automaticos" de arriba: ensureCurrentEditions() solo los CREA
// (status:'published'), pero cerrar la inscripcion y armar el bracket
// exigia SIEMPRE que un admin entrara a mano y generara el bracket
// (POST /api/admin/events/:id/bracket/generate). En la practica, el
// "Blitz Diario" nunca arrancaba solo.
//
// Mismo principio de siempre (sin cron real, Render puede reiniciar
// el proceso): se revisa al vuelo que torneo ya esta vencido, se
// arma el bracket (formato suizo o eliminacion -- swissRoundsNeeded/
// generateSwissRound de services/tournament.js) y se pasa a
// status:'active' en UNA sola escritura atomica por torneo, para que
// dos requests casi simultaneas nunca lo arranquen dos veces.
const { generateFirstRound } = require('./tournament');

async function startDueTournaments(now = new Date()) {
  const due = await Event.find({
    type: 'tournament',
    status: 'published',
    startsAt: { $lte: now },
  }).populate('participants', 'username').select('participants format bracket.rounds');

  const started = [];
  for (const event of due) {
    if (event.bracket?.rounds?.length) continue; // ya tiene bracket -- no deberia pasar, pero defensivo
    const participants = (event.participants || []).map((p) => ({ userId: p._id, name: p.username }));

    // Ronda 1 es igual sea cual sea el formato: mezclar al azar y
    // emparejar -- sin historial todavia, un suizo "ordenado por
    // puntaje" seria simplemente el orden de inscripcion, nada justo.
    // Recien la ronda 2 en adelante es donde Suizo se diferencia de
    // Eliminacion (ver el ramal por event.format en
    // handleTournamentMatchFinished, server.js).
    const update = participants.length >= 2
      ? { $set: { status: 'active', bracket: { rounds: [generateFirstRound(participants)], championId: null, championName: '' } } }
      : { $set: { status: 'cancelled' } };

    // Reclamo atomico: si dos requests casi simultaneas llegan hasta
    // aca para el MISMO torneo, solo la primera encuentra
    // status:'published' todavia -- la segunda no matchea nada.
    const claimed = await Event.findOneAndUpdate({ _id: event._id, status: 'published' }, update);
    if (!claimed) continue;

    started.push(String(event._id));
    if (participants.length >= 2) {
      console.log(`[Tournament] Auto-inicio: "${claimed.title}" arranco con ${participants.length} jugadores (${event.format || 'elimination'}).`);
    } else {
      console.log(`[Tournament] "${claimed.title}" cancelado automaticamente: no llego a 2 inscritos.`);
    }
  }
  return started;
}

module.exports = { RECURRING_TEMPLATES, editionKeyFor, editionStartsAtFor, ensureCurrentEditions, startDueTournaments };
