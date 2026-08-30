'use strict';

// Logica pura del bracket de eliminacion directa -- sin tocar la base
// de datos ni sockets, asi la puede usar tanto routes/admin.js (crear
// el bracket) como server.js (avanzar de ronda cuando termina una
// partida). players: [{ userId, name }].

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Empareja una lista de jugadores en partidos. Si sobra uno (numero
// impar), el ultimo pasa como "bye" (avanza directo, sin jugar).
function pairUp(players) {
  const matches = [];
  for (let i = 0; i < players.length; i += 2) {
    const p1 = players[i];
    const p2 = players[i + 1] || null;
    matches.push({
      player1: p1?.userId || null,
      player2: p2?.userId || null,
      player1Name: p1?.name || '',
      player2Name: p2?.name || '',
      winner: p2 ? null : (p1?.userId || null),
      roomCode: null,
      status: p2 ? 'ready' : 'bye',
    });
  }
  return matches;
}

// Genera la ronda 1 completa a partir de la lista de inscritos --
// mezcla al azar y empareja. Se llama una sola vez, al arrancar el
// torneo.
function generateFirstRound(participants) {
  const shuffled = shuffle(participants);
  return { matches: pairUp(shuffled) };
}

// A partir de los ganadores de la ronda actual (en el mismo orden que
// sus partidos), arma la ronda siguiente. Si solo queda un ganador,
// ese es el campeon -- se devuelve null (no hay ronda siguiente).
function generateNextRound(winners) {
  if (winners.length <= 1) return null;
  return { matches: pairUp(winners) };
}

module.exports = { shuffle, pairUp, generateFirstRound, generateNextRound };
