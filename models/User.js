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
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    elo: { type: Number, default: 1200 },
    stats: {
      wins:   { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws:  { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
    },

    // ELO y estadisticas de Damas, separados de los de ajedrez -- son
    // juegos distintos, cada uno con su propio ranking.
    damasElo: { type: Number, default: 1200 },
    damasStats: {
      wins:   { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws:  { type: Number, default: 0 },
      streak: { type: Number, default: 0 },
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
};

// Misma formula K-factor que updateElo, pero sobre damasElo -- Damas
// tiene su propio ranking, no comparte el de ajedrez.
UserSchema.methods.updateDamasElo = function (opponentElo, result) {
  const K  = this.damasElo < 2100 ? 32 : this.damasElo < 2400 ? 24 : 16;
  const Ea = 1 / (1 + Math.pow(10, (opponentElo - this.damasElo) / 400));
  this.damasElo = Math.max(100, Math.round(this.damasElo + K * (result - Ea)));
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
