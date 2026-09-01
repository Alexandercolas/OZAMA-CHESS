'use strict';

const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'El titulo es obligatorio'],
      trim: true,
      maxlength: [90, 'Maximo 90 caracteres'],
    },
    type: {
      type: String,
      enum: ['event', 'tournament', 'announcement', 'maintenance'],
      default: 'event',
    },
    // Solo aplica a type:'tournament' -- que juego se juega en este
    // torneo. services/tournament.js (el armado del bracket en si) ya
    // es agnostico al juego; esto es lo que le dice a server.js que
    // camino de salas usar (rooms/Match para ajedrez, damasRooms/
    // DamasMatch para damas) al confirmar cada partido.
    gameType: {
      type: String,
      enum: ['chess', 'checkers'],
      default: 'chess',
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'finished', 'cancelled', 'published', 'closed'],
      default: 'draft',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1200, 'Maximo 1200 caracteres'],
      default: '',
    },
    startsAt: { type: Date, default: null },
    endsAt:   { type: Date, default: null },
    maxPlayers: {
      type: Number,
      min: 2,
      max: 512,
      default: 16,
    },

    // Metadata de torneo (Fase 2, "OZAMA Torneos + Experiencia Visual").
    // Todo opcional/aditivo -- los eventos viejos (sin nada de esto)
    // siguen funcionando igual, solo se ven mas simples en la card.
    format: {
      type: String,
      enum: ['elimination', 'arena', 'swiss', 'round_robin'],
      default: 'elimination',
    },
    // Texto libre tipo "5+0", "10+0", "3+2" -- igual que como ya se
    // muestra el control de tiempo en el resto de la app (nunca se
    // valida contra una lista cerrada, es solo informativo).
    timeControl: { type: String, trim: true, maxlength: 20, default: '' },
    // Texto libre tipo "Insignia + XP" -- la recompensa REAL (logro,
    // XP, marco) la otorga services/achievements.js / server.js al
    // coronar campeon; esto es solo lo que se muestra en la card antes
    // de jugar.
    reward: { type: String, trim: true, maxlength: 80, default: '' },
    icon: { type: String, trim: true, maxlength: 8, default: '' },
    minRating: { type: Number, min: 0, max: 4000, default: null },
    maxRating: { type: Number, min: 0, max: 4000, default: null },
    // Torneos recurrentes (Fase 9-10, "OZAMA PRO / Experiencia Final"):
    // 'none' es un torneo unico de siempre. Los demas se generan solos
    // -- ver services/recurringTournaments.js. Mismo principio que el
    // puzzle diario (services/puzzles.js: dailyPuzzleForDate): la
    // "edicion actual" se CALCULA a partir de la fecha, nunca un cron
    // que la crea de antemano (poco confiable en Render, que puede
    // reiniciar el proceso). recurrenceKey identifica esa edicion de
    // forma deterministica (ej: "blitz-diario-2026-08-31") -- el
    // indice unico disperso evita que dos requests casi simultaneas
    // creen la misma edicion dos veces.
    recurrence: {
      type: String,
      enum: ['none', 'daily', 'weekly', 'monthly'],
      default: 'none',
    },
    recurrenceKey: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Bracket de eliminacion directa -- solo aplica a type:'tournament'.
    // Los nombres van duplicados aca (ademas de participants con los
    // ObjectId) para poder mostrar el bracket publico sin tener que
    // hacer populate() en cada consulta.
    bracket: {
      rounds: [{
        matches: [{
          player1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          player2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          player1Name: { type: String, default: '' },
          player2Name: { type: String, default: '' },
          winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
          roomCode: { type: String, default: null },
          status: {
            type: String,
            enum: ['pending', 'bye', 'ready', 'playing', 'finished'],
            default: 'pending',
          },
        }],
      }],
      championId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      championName: { type: String, default: '' },
    },
  },
  { timestamps: true }
);

EventSchema.index({ status: 1, startsAt: 1 });
EventSchema.index({ type: 1, createdAt: -1 });
EventSchema.index({ recurrenceKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Event', EventSchema);
