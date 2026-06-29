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
      minlength: [3, 'Mínimo 3 caracteres'],
      maxlength: [20, 'Máximo 20 caracteres'],
      match: [/^[a-zA-Z0-9_]+$/, 'Solo letras, números y guión bajo'],
    },
    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email inválido'],
    },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [6, 'Mínimo 6 caracteres'],
      select: false, // no se devuelve en queries por defecto
    },

    // ── Perfil ─────────────────────────────────────────────────────
    country: { type: String, default: 'DO' },   // ISO 3166-1 alpha-2
    avatar:  { type: Number, default: 0 },       // índice de avatar predefinido
    avatarImage: { type: String, default: '' },

    // ── ELO + estadísticas ──────────────────────────────────────────
    elo: { type: Number, default: 1200 },
    stats: {
      wins:   { type: Number, default: 0 },
      losses: { type: Number, default: 0 },
      draws:  { type: Number, default: 0 },
    },

    // ── Metadatos ───────────────────────────────────────────────────
    lastSeenAt: { type: Date, default: Date.now },
    isActive:   { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ── Hash de contraseña antes de guardar ─────────────────────────
UserSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

// ── Comparar contraseña ─────────────────────────────────────────
UserSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ── ELO update helper ───────────────────────────────────────────
UserSchema.methods.updateElo = function (opponentElo, result) {
  // result: 1 = win, 0.5 = draw, 0 = loss
  const K  = this.elo < 2100 ? 32 : this.elo < 2400 ? 24 : 16;
  const Ea = 1 / (1 + Math.pow(10, (opponentElo - this.elo) / 400));
  this.elo  = Math.max(100, Math.round(this.elo + K * (result - Ea)));
};

// ── toJSON limpio (sin password, sin __v) ───────────────────────
UserSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('User', UserSchema);
