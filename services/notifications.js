'use strict';

const Notification = require('../models/Notification');

// Centro de notificaciones (Fase 8 del roadmap PRO): un solo lugar
// que escribe la notificacion en Mongo Y la empuja en vivo (si el
// destinatario tiene algun socket conectado ahora mismo, via el room
// personal "user:<id>" al que todo socket autenticado se une solo en
// io.on('connection') en server.js) -- asi cada punto de disparo
// (agregar amigo, revancha, logro...) es una sola linea, en vez de
// repetir la escritura + el emit en cada lugar. Nunca tira: un fallo
// al notificar no deberia tumbar la accion real (agregar amigo,
// otorgar un logro, etc.) que la origino.
async function notify(io, userId, { type, icon, title, body = '', link = '' }) {
  if (!userId || !type || !title) return null;
  try {
    const doc = await Notification.create({ userId, type, icon, title, body, link });
    io?.to(`user:${userId}`).emit('notification', {
      id: doc._id, type: doc.type, icon: doc.icon, title: doc.title,
      body: doc.body, link: doc.link, read: doc.read, createdAt: doc.createdAt,
    });
    return doc;
  } catch (err) {
    console.warn('[Notifications] No se pudo crear notificacion:', err.message);
    return null;
  }
}

module.exports = { notify };
