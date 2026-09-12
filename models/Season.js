'use strict';

const mongoose = require('mongoose');

// Temporadas (Fase 1, roadmap "OZAMA PRO - FASE FINAL"). Ajedrez y
// Damas tienen temporadas independientes -- por eso "game" es parte
// de la clave, no un campo aparte de un documento global. Usa 'chess'/
// 'damas' (la misma convencion que ya usan achievements.js/damasStats/
// el ?game= de /api/user/leaderboard), NO 'checkers' como
// Event.gameType -- son sistemas distintos, sin relacion directa.
//
// El RATING PERMANENTE (User.elo / User.damasElo) nunca vive aca ni se
// toca al cerrar una temporada -- este modelo solo guarda la
// clasificacion/premios de la ventana de tiempo que ya paso. Ver
// services/seasons.js para el ciclo de vida completo.
const SeasonStandingSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    username: { type: String, default: '' },
    rank:    { type: Number, required: true },
    elo:     { type: Number, default: 1200 },
    wins:    { type: Number, default: 0 },
    losses:  { type: Number, default: 0 },
    draws:   { type: Number, default: 0 },
    games:   { type: Number, default: 0 },
    reward:  { type: String, default: '' },
  },
  { _id: false }
);

const SeasonSchema = new mongoose.Schema(
  {
    game: { type: String, enum: ['chess', 'damas'], required: true },
    number: { type: Number, required: true },
    name: { type: String, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    // Duracion RESUELTA al crear esta temporada -- si mas adelante se
    // cambia SEASON_DURATION_DAYS, las temporadas ya creadas conservan
    // la suya propia (nunca se recalculan fechas ya fijadas).
    durationDays: { type: Number, required: true },
    // 'closing' es transitorio: se usa como guarda atomica mientras se
    // calculan clasificacion/premios, para que dos procesos (o dos
    // llamadas casi simultaneas) nunca repartan premios dos veces. Si
    // el proceso se cae a mitad de camino, la temporada queda en
    // 'closing' y el proximo ensureCurrentSeason() reintenta el cierre
    // desde cero (es seguro: otorgar logros y guardar historial son
    // operaciones idempotentes, ver closeSeason() en seasons.js).
    status: { type: String, enum: ['active', 'closing', 'finished'], default: 'active' },
    // Marca de tiempo de CUANDO se reclamo el cierre -- permite
    // distinguir "otro proceso la esta cerrando ahora mismo" (no
    // pisarle el trabajo) de "quedo pegada por una caida" (reintentar
    // pasado un margen de gracia). Ver closeSeason() en services/
    // seasons.js.
    closingStartedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    totalParticipants: { type: Number, default: 0 },
    // Top 20 nada mas -- un "hall of fame" publico de la temporada, no
    // el historial completo de todo el mundo (eso vive en
    // SeasonHistory, una fila liviana por usuario, para que este
    // documento no crezca sin limite con la cantidad de jugadores).
    topStandings: { type: [SeasonStandingSchema], default: [] },
  },
  { timestamps: true }
);

// Unico indice que de verdad importa para la seguridad del cierre: dos
// intentos de crear la temporada #N del mismo juego chocan aca, nunca
// en la app -- MongoDB rechaza el segundo insert (E11000).
SeasonSchema.index({ game: 1, number: 1 }, { unique: true });
SeasonSchema.index({ game: 1, status: 1 });

module.exports = mongoose.model('Season', SeasonSchema);
