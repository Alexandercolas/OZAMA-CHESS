'use strict';

// Reportes de jugadores (Fase 10 del roadmap PRO). Separado de
// AdminAudit a proposito -- AdminAudit registra acciones que un ADMIN
// ya tomo; esto registra una denuncia de un JUGADOR, pendiente de que
// un admin la revise (ver routes/admin.js).
const mongoose = require('mongoose');

const REASONS = ['comportamiento_toxico', 'trampa_sospechada', 'nombre_inapropiado', 'otro'];

const ReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reported: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: REASONS, required: true },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reported: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
module.exports.REASONS = REASONS;
