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
      // 'no-progress' (Fase 15, "Damas"): tablas automaticas por falta
      // de progreso -- ver NO_PROGRESS_PLY_LIMIT en server.js. Antes de
      // esto, Damas no tenia ningun equivalente a la regla de 50
      // movimientos de Ajedrez (game.halfMoveClock/'fifty_move' en
      // server.js) y una partida entre dos reyes podia, en teoria,
      // durar para siempre sin que ninguno de los dos ofreciera tablas.
      enum: ['no-pieces', 'no-moves', 'resign', 'opponent-left', 'admin-closed', 'draw', 'no-progress'],
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

    // Ver el mismo campo en models/Match.js -- sin default, "sin dato"
    // en vez de asumir el viejo ritmo por defecto en partidas viejas.
    timeControl: { type: String, trim: true, maxlength: 10 },

    startedAt: { type: Date, default: Date.now },
    endedAt:   { type: Date, default: Date.now },
  },
  { timestamps: true }
);

DamasMatchSchema.index({ 'whitePlayer.userId': 1, createdAt: -1 });
DamasMatchSchema.index({ 'blackPlayer.userId': 1, createdAt: -1 });
// Paridad con Match: mismo filtro/orden en leaderboard/climbers e historial.
DamasMatchSchema.index({ result: 1 });
DamasMatchSchema.index({ endedAt: -1 });

module.exports = mongoose.model('DamasMatch', DamasMatchSchema);
