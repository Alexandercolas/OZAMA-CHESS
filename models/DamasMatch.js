'use strict';

const mongoose = require('mongoose');

// Version simplificada de models/Match.js (ajedrez): Damas no lleva
// notacion jugada-por-jugada, asi que aqui solo se guarda el resultado
// final de cada partida -- suficiente para historial y ELO.
const DamasPlayerSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name:    { type: String, required: true },
    country: { type: String, default: 'DO' },
    avatar:  { type: Number, default: 0 },
    avatarImage: { type: String, default: '' },
    elo:     { type: Number, default: 1200 },
  },
  { _id: false }
);

const DamasMatchSchema = new mongoose.Schema(
  {
    roomCode:    { type: String, required: true, uppercase: true },
    whitePlayer: { type: DamasPlayerSchema, required: true },
    blackPlayer: { type: DamasPlayerSchema, required: true },

    result: {
      type: String,
      enum: ['white_win', 'black_win', 'draw', 'abandoned'],
      required: true,
    },
    winner: { type: String, enum: ['w', 'b', null], default: null },
    reason: {
      type: String,
      enum: ['no-pieces', 'no-moves', 'resign', 'opponent-left', 'admin-closed', 'draw'],
      required: true,
    },

    eloChange: {
      white: { type: Number, default: null },
      black: { type: Number, default: null },
    },

    // Ver el mismo campo en models/Match.js -- misma logica, mismo
    // "no analizada" != "cero errores".
    analysisSummary: {
      blunders: { type: Number, default: null },
      inaccuracies: { type: Number, default: null },
      analyzedAt: { type: Date, default: null },
    },

    startedAt: { type: Date, default: Date.now },
    endedAt:   { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DamasMatchSchema.index({ 'whitePlayer.userId': 1, createdAt: -1 });
DamasMatchSchema.index({ 'blackPlayer.userId': 1, createdAt: -1 });

module.exports = mongoose.model('DamasMatch', DamasMatchSchema);
