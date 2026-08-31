'use strict';

const mongoose = require('mongoose');

const MoveSchema = new mongoose.Schema(
  {
    from: {
      row: { type: Number, min: 0, max: 7, required: true },
      col: { type: Number, min: 0, max: 7, required: true },
    },
    to: {
      row: { type: Number, min: 0, max: 7, required: true },
      col: { type: Number, min: 0, max: 7, required: true },
    },
    promotion: { type: String, enum: ['q', 'r', 'b', 'n', null], default: null },
    playedBy:  { type: String, enum: ['w', 'b'], required: true },
    playedAt:  { type: Date, default: Date.now },
  },
  { _id: false }
);

const PlayerSchema = new mongoose.Schema(
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

const MatchSchema = new mongoose.Schema(
  {
    roomCode:    { type: String, required: true, uppercase: true },
    whitePlayer: { type: PlayerSchema, required: true },
    blackPlayer: { type: PlayerSchema, required: true },

    moves: [MoveSchema],
    pgn:   { type: String, default: '' },

    result: {
      type: String,
      enum: ['in_progress', 'white_win', 'black_win', 'draw', 'abandoned'],
      default: 'in_progress',
    },
    winner: { type: String, enum: ['w', 'b', null], default: null },

    // Como termino exactamente (Fase E del roadmap PRO 2.0 --
    // estadisticas de "victorias por jaque mate" vs "por tiempo", etc).
    // null en partidas viejas, de antes de que se empezara a guardar
    // esto -- las estadisticas que lo usan lo tratan como dato
    // faltante, no como cero.
    endReason: {
      type: String,
      enum: ['checkmate', 'stalemate', 'resign', 'timeout', 'abandoned', 'draw_agreed', 'fifty_move', null],
      default: null,
    },

    // Resumen del analisis post-partida (Fase F, Centro de Analisis)
    // -- se guarda UNA vez, cuando el jugador corre "Analizar partida"
    // (beneficio Premium). No se recalcula solo: si ninguno de los dos
    // jugadores la analizo nunca, este campo queda null para siempre,
    // y las estadisticas que lo usan lo tratan como "no analizada",
    // nunca como "cero errores".
    analysisSummary: {
      blunders: { type: Number, default: null },
      inaccuracies: { type: Number, default: null },
      analyzedAt: { type: Date, default: null },
    },

    eloChange: {
      white: { type: Number, default: null },
      black: { type: Number, default: null },
    },

    startedAt: { type: Date, default: Date.now },
    endedAt:   { type: Date, default: null },
  },
  { timestamps: true }
);

MatchSchema.index({ 'whitePlayer.userId': 1, createdAt: -1 });
MatchSchema.index({ 'blackPlayer.userId': 1, createdAt: -1 });
MatchSchema.index({ result: 1 });

module.exports = mongoose.model('Match', MatchSchema);
