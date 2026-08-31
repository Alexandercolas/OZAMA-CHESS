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

module.exports = mongoose.model('Event', EventSchema);
