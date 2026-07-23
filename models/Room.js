'use strict';

const mongoose = require('mongoose');

const RoomPlayerSchema = new mongoose.Schema(
  {
    socketId: { type: String, default: null },
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name:     { type: String, default: '' },
    country:  { type: String, default: 'DO' },
    avatar:   { type: Number, default: 0 },
    avatarImage: { type: String, default: '' },
  },
  { _id: false }
);

const RoomSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true, uppercase: true },
    players: {
      white: { type: RoomPlayerSchema, default: () => ({}) },
      black: { type: RoomPlayerSchema, default: () => ({}) },
    },
    match:  { type: mongoose.Schema.Types.ObjectId, ref: 'Match', default: null },
    fen:    { type: String, default: 'startpos' },
    turn:   { type: String, enum: ['w', 'b'], default: 'w' },
    gameState: { type: mongoose.Schema.Types.Mixed, default: null },
    clockW: { type: Number, default: 600000 },
    clockB: { type: Number, default: 600000 },
    status: {
      type: String,
      enum: ['waiting', 'playing', 'finished', 'closed'],
      default: 'waiting',
    },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// TTL: salas cerradas se eliminan de Atlas después de 1 hora
RoomSchema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.model('Room', RoomSchema);
