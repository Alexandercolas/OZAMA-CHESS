'use strict';

// ================================================================
//  OZAMA CHESS — server.js
//  Node.js + Express + Socket.io
//  Maneja salas, turnos y sincronización de movidas en tiempo real
// ================================================================

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Servir todos los archivos del juego desde la misma carpeta
app.use(express.static(path.join(__dirname)));

// ── Almacenamiento de salas en memoria ────────────────────────────
// Map<roomCode, { white: socketId|null, black: socketId|null, timer: TimeoutId|null }>
const rooms = new Map();

// ── Generador de código de sala ───────────────────────────────────
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── Conexiones Socket.io ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── Crear sala nueva ──────────────────────────────────────────
  socket.on('create-room', () => {
    // Generar código único
    let code;
    do { code = generateCode(); } while (rooms.has(code));

    rooms.set(code, { white: socket.id, black: null, timer: null });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color    = 'w';

    socket.emit('room-created', { code, color: 'w' });
    console.log(`[R] Sala ${code} creada por ${socket.id}`);
  });

  // ── Unirse a sala existente ───────────────────────────────────
  socket.on('join-room', ({ code }) => {
    const cleanCode = (code || '').toUpperCase().trim();
    const room      = rooms.get(cleanCode);

    if (!room) {
      socket.emit('room-error', 'Sala no encontrada. Revisa el código.');
      return;
    }
    if (room.black) {
      socket.emit('room-error', 'La sala ya está llena.');
      return;
    }

    // Cancelar timer de cierre si estaba activo
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }

    room.black = socket.id;
    socket.join(cleanCode);
    socket.data.roomCode = cleanCode;
    socket.data.color    = 'b';

    socket.emit('room-joined', { code: cleanCode, color: 'b' });

    // Notificar a ambos jugadores que la partida puede comenzar
    io.to(cleanCode).emit('game-start', { code: cleanCode });
    console.log(`[R] Sala ${cleanCode} — ¡partida iniciada!`);
  });

  // ── Reconexión tras redirección lobby → juego ─────────────────
  socket.on('rejoin', ({ roomCode, color }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    // Cancelar timer de cierre
    if (room.timer) {
      clearTimeout(room.timer);
      room.timer = null;
    }

    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.color    = color;

    // Actualizar socket ID del jugador reconectado
    if (color === 'w') room.white = socket.id;
    else               room.black = socket.id;

    // Notificar al rival que el jugador volvió
    socket.to(roomCode).emit('opponent-reconnected');
    console.log(`[R] ${color.toUpperCase()} reconectado a sala ${roomCode}`);
  });

  // ── Retransmitir movida al rival ──────────────────────────────
  socket.on('move', (moveData) => {
    const code = socket.data.roomCode;
    if (!code) return;
    // Enviar SOLO al otro jugador de la sala (no al emisor)
    socket.to(code).emit('opponent-move', moveData);
  });

  // ── Desconexión ───────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) {
      console.log(`[-] Desconectado: ${socket.id}`);
      return;
    }

    const room = rooms.get(code);
    if (!room) return;

    // Avisar al rival
    socket.to(code).emit('opponent-disconnected');
    console.log(`[-] ${socket.data.color?.toUpperCase()} salió de sala ${code}`);

    // Dar 30 segundos para reconectarse antes de cerrar la sala
    room.timer = setTimeout(() => {
      rooms.delete(code);
      console.log(`[X] Sala ${code} cerrada por inactividad`);
    }, 30_000);
  });
});

// ── Arrancar servidor ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n♟  OZAMA CHESS — Servidor corriendo`);
  console.log(`   → http://localhost:${PORT}/lobby.html\n`);
});