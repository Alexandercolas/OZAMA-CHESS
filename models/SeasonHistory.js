'use strict';

const mongoose = require('mongoose');

// Una fila por (usuario, juego, temporada) -- separado de Season para
// que "consultar mis temporadas anteriores" (Fase 1: HISTORIAL) no
// dependa de buscar dentro del array topStandings de cada Season (que
// solo guarda el top 20). Cualquier jugador que participo, este o no
// en el top 20 publico, tiene su propia fila aca.
//
// El indice unico (userId, game, seasonNumber) es lo que hace que
// escribir esto sea un upsert idempotente de verdad: si
// closeSeason() se reintenta despues de una caida a mitad de camino,
// $setOnInsert nunca duplica una fila ya escrita.
const SeasonHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    game: { type: String, enum: ['chess', 'damas'], required: true },
    seasonNumber: { type: Number, required: true },
    seasonName: { type: String, required: true },
    rank: { type: Number, required: true },
    elo: { type: Number, default: 1200 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    // Texto libre tipo "Campeón de temporada + Marco + XP" -- mismo
    // patron que Event.reward, pensado para mostrarse directo en la
    // UI sin tener que reconstruirlo a partir del rank.
    reward: { type: String, default: '' },
    xpAwarded: { type: Number, default: 0 },
    closedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

SeasonHistorySchema.index({ userId: 1, game: 1, seasonNumber: 1 }, { unique: true });
SeasonHistorySchema.index({ userId: 1, closedAt: -1 });

module.exports = mongoose.model('SeasonHistory', SeasonHistorySchema);
