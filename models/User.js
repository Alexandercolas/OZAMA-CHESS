'use strict';

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'El nombre de usuario es obligatorio'],
      unique: true,
      trim: true,
      minlength: [3, 'Minimo 3 caracteres'],
      maxlength: [20, 'Maximo 20 caracteres'],
      match: [/^[a-zA-Z0-9_]+$/, 'Solo letras, numeros y guion bajo'],
    },
    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email invalido'],
    },
    password: {
      type: String,
      required: [true, 'La contrasena es obligatoria'],
      minlength: [8, 'Minimo 8 caracteres'],
      select: false,
    },
    recoveryCodeHash: {
      type: String,
      select: false,
    },
    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },
    googleSub: {
      type: String,
      unique: true,
      sparse: true,
      select: false,
    },
    authProviders: {
      password: { type: Boolean, default: true },
      google: { type: Boolean, default: false },
    },

    country: {
      type: String,
      default: 'DO',
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{2}$/, 'Pais invalido'],
    },
    avatar: {
      type: Number,
      default: 0,
      min: 0,
      max: 12,
    },
    avatarImage: { type: String, default: '' },
    // Bio/estado corto (Fase 11, "Personalizacion PRO" -- PERFIL).
    // Texto libre, nunca obligatorio, nunca se muestra si esta vacio.
    bio: { type: String, trim: true, maxlength: 140, default: '' },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // Bloqueo (Fase 10 del roadmap PRO): unidireccional a proposito --
    // si A bloquea a B, B no puede desafiar a A, sin que B se entere
    // ni necesite tambien bloquear a A. Ver server.js (challenge-send)
    // para donde se hace cumplir.
    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    elo: { type: Number, default: 1200 },
    stats: {
      wins:   { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws:  { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      // Mejor ELO de siempre (Fase 5, "Perfil Competitivo"). Arranca en
      // 1200 (el ELO inicial), no en 0 -- 0 se veria como una caida real
      // para alguien que ni jugo su primera partida. updateElo() de mas
      // abajo es el unico lugar que lo actualiza.
      bestElo: { type: Number, default: 1200 },
    },

    // ELO y estadisticas de Damas, separados de los de ajedrez -- son
    // juegos distintos, cada uno con su propio ranking.
    damasElo: { type: Number, default: 1200 },
    damasStats: {
      wins:   { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws:  { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      bestElo: { type: Number, default: 1200 },
    },

    // Progresion (Fase 4 del roadmap PRO): XP acumulada de ajedrez +
    // Damas juntos (una sola barra de progreso para todo OZAMA, no
    // separada por juego -- el nivel es del jugador, no del juego) y
    // los logros que ya desbloqueo. Ver services/achievements.js para
    // el catalogo completo y como se otorgan.
    xp: { type: Number, default: 0 },
    achievements: [{
      key: { type: String, required: true },
      unlockedAt: { type: Date, default: Date.now },
    }],
    // Coleccion (Fase 13): marco de perfil equipado. Cual esta
    // DESBLOQUEADO se calcula siempre a partir de xp/achievements de
    // arriba (services/cosmetics.js) -- aca solo se guarda la eleccion.
    equippedFrame: { type: String, default: 'ninguno' },
    // Titulo ESPECIAL equipado (Fase 9: "Titulos y Rangos"). null =
    // usa el titulo automatico por nivel (titleForLevel en
    // services/titles.js, sin cambios). Se desbloquean jugando
    // (torneos/temporadas/logros/rendimiento, ver SPECIAL_TITLES en
    // services/titles.js) -- mismo patron que equippedFrame, nunca se
    // guarda "cual esta desbloqueado", solo la eleccion.
    equippedTitle: { type: String, default: null },

    // Entrenamiento tactico (Fase 8 del roadmap PRO). solvedKeys evita
    // repetir un puzzle ya resuelto en el modo practica; lastDailyDate
    // evita contar el desafio del dia dos veces; streak/lastSolvedDate
    // llevan la racha de DIAS consecutivos con al menos un puzzle
    // resuelto (independiente de la racha de victorias en partidas).
    // Ver services/puzzles.js para el catalogo y routes/puzzles.js
    // para donde se actualiza todo esto.
    puzzles: {
      solvedKeys: { type: [String], default: [] },
      totalSolved: { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      lastSolvedDate: { type: String, default: null },
      lastDailyDate: { type: String, default: null },
    },
    // Mismo shape que `puzzles` de arriba, pero para el catalogo de
    // Damas (services/damas-puzzles.js) -- catalogos y rachas
    // separadas por juego, igual que el ELO/estadisticas. El XP si es
    // compartido (ver el comentario de xp arriba).
    damasPuzzles: {
      solvedKeys: { type: [String], default: [] },
      totalSolved: { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
      bestStreak: { type: Number, default: 0 },
      lastSolvedDate: { type: String, default: null },
      lastDailyDate: { type: String, default: null },
    },

    // The paid plan must never provide competitive advantages.
    plan: {
      type: String,
      enum: ['free', 'premium'],
      default: 'free',
    },
    premiumUntil: { type: Date, default: null },
    paypalSubscriptionId: { type: String, default: null, select: false },
    subscriptionStatus: {
      type: String,
      enum: ['none', 'trial', 'active', 'past_due', 'cancelled'],
      default: 'none',
    },

    lastSeenAt: { type: Date, default: Date.now },
    isActive:   { type: Boolean, default: true },
    isAdmin:    { type: Boolean, default: false },

    // Personalizacion (Fase 2 del roadmap PRO). Mixed a proposito: la
    // idea es poder sumar preferencias nuevas (set de piezas,
    // intensidad de animaciones, densidad de interfaz...) sin tener
    // que migrar el esquema cada vez -- routes/user.js valida contra
    // una lista blanca de claves conocidas, esto solo define donde
    // vive el dato.
    preferences: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

// El leaderboard ordena por estos dos campos (routes/user.js) -- sin
// indice era collection scan + sort en memoria en toda la base de
// usuarios. Agregar un indice no es destructivo, Mongo lo construye solo.
UserSchema.index({ elo: -1 });
UserSchema.index({ damasElo: -1 });

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  if (/^\$2[aby]\$\d{2}\$/.test(this.password)) return;
  this.password = await bcrypt.hash(this.password, 12);
});

UserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.compareRecoveryCode = async function (candidate) {
  if (!this.recoveryCodeHash || !candidate) return false;
  return bcrypt.compare(String(candidate).trim().toUpperCase(), this.recoveryCodeHash);
};

UserSchema.methods.updateElo = function (opponentElo, result) {
  const K  = this.elo < 2100 ? 32 : this.elo < 2400 ? 24 : 16;
  const Ea = 1 / (1 + Math.pow(10, (opponentElo - this.elo) / 400));
  this.elo  = Math.max(100, Math.round(this.elo + K * (result - Ea)));
  // Mejor ELO de siempre (Fase 5 del roadmap PRO, tarjeta de perfil) --
  // un solo lugar, igual que bumpStreak en server.js: se actualiza en
  // la MISMA operacion que ya cambia el ELO, nunca aparte.
  if (this.elo > Number(this.stats.bestElo || 0)) this.stats.bestElo = this.elo;
};

// Misma formula K-factor que updateElo, pero sobre damasElo -- Damas
// tiene su propio ranking, no comparte el de ajedrez.
UserSchema.methods.updateDamasElo = function (opponentElo, result) {
  const K  = this.damasElo < 2100 ? 32 : this.damasElo < 2400 ? 24 : 16;
  const Ea = 1 / (1 + Math.pow(10, (opponentElo - this.damasElo) / 400));
  this.damasElo = Math.max(100, Math.round(this.damasElo + K * (result - Ea)));
  if (this.damasElo > Number(this.damasStats.bestElo || 0)) this.damasStats.bestElo = this.damasElo;
};

UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.recoveryCodeHash;
    delete ret.tokenVersion;
    delete ret.googleSub;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', UserSchema);
