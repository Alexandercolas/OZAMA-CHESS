'use strict';

const mongoose = require('mongoose');

const DamasRoomSchema = new mongoose.Schema({
  roomCode: { type: String, required: true, unique: true, uppercase: true },
  status: { type: String, enum: ['playing', 'finished', 'closed'], required: true },
  board: { type: mongoose.Schema.Types.Mixed, required: true },
  turn: { type: String, enum: ['w', 'b'], required: true },
  playerInfo: { type: mongoose.Schema.Types.Mixed, required: true },
  tokens: {
    w: { type: String, select: false, required: true },
    b: { type: String, select: false, required: true },
  },
  clockW: { type: Number, required: true },
  clockB: { type: Number, required: true },
  timeControl: { type: String, required: true },
  startedAt: { type: Date, required: true },
  noProgressPlies: { type: Number, default: 0 },
  hadPromotion: { type: mongoose.Schema.Types.Mixed, default: null },
  hadMultiCapture: { type: mongoose.Schema.Types.Mixed, default: null },
  tournamentMeta: { type: mongoose.Schema.Types.Mixed, default: null },
  lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });

DamasRoomSchema.index({ lastActivityAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('DamasRoom', DamasRoomSchema);
