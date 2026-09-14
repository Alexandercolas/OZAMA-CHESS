'use strict';

// Centro de notificaciones (Fase 8 del roadmap PRO). Auditoria previa
// confirmo que esto no existia en absoluto -- ni modelo, ni endpoint,
// ni UI, ni siquiera un campo de "visto" en User. Los eventos en vivo
// que YA existian (challenge-received, rematch-requested, etc.) solo
// llegaban a quien estuviera esa pagina en ese momento; esto le suma
// una copia PERSISTENTE que sobrevive a que el destinatario no
// estuviera conectado, mas el "visto/no visto" que tampoco existia.
const mongoose = require('mongoose');

// Coincide con los 11 tipos pedidos por el roadmap. 'resultado' y
// 'actividad_relevante' quedan en el enum para uso futuro pero
// deliberadamente SIN disparador automatico todavia -- ver
// services/notifications.js para el detalle de esa decision de
// alcance (evitar inundar el centro de notificaciones con una entrada
// por cada partida terminada, cuando los dos jugadores ya lo vieron
// en vivo en el tablero).
const TYPES = [
  'invitacion', 'amigo', 'revancha', 'torneo', 'inicio_torneo',
  'temporada', 'recompensa', 'logro', 'mision', 'resultado', 'actividad_relevante',
];

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: TYPES, required: true },
    icon: { type: String, trim: true, maxlength: 8, default: '🔔' },
    title: { type: String, trim: true, maxlength: 120, required: true },
    body: { type: String, trim: true, maxlength: 300, default: '' },
    // A donde lleva un click -- ruta relativa propia de la app
    // (ej "/tournaments.html?id=..."), nunca una URL externa.
    link: { type: String, trim: true, maxlength: 200, default: '' },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);
module.exports.TYPES = TYPES;
