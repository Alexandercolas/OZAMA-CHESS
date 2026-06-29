'use strict';

const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI no está definida en .env');

  mongoose.connection.on('connected',    () => console.log('[DB] ✅ MongoDB Atlas conectado'));
  mongoose.connection.on('error',        (err) => console.error('[DB] ❌ Error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[DB] ⚠️  MongoDB desconectado'));

  await mongoose.connect(uri, {
    dbName: 'ozama-chess',
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
}

module.exports = connectDatabase;