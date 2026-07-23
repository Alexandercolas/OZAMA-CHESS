'use strict';

const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'El titulo es obligatorio'],
      trim: true,
      maxlength: [90, 'Maximo 90 caracteres'],
    },
    type: {
      type: String,
      enum: ['event', 'tournament', 'announcement', 'maintenance'],
      default: 'event',
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'closed'],
      default: 'draft',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1200, 'Maximo 1200 caracteres'],
      default: '',
    },
    startsAt: { type: Date, default: null },
    endsAt:   { type: Date, default: null },
    maxPlayers: {
      type: Number,
      min: 2,
      max: 512,
      default: 16,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

EventSchema.index({ status: 1, startsAt: 1 });
EventSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Event', EventSchema);
