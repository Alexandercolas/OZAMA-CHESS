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

// ================================================================
// SUIZO (Fase 3, Torneos PRO) -- a diferencia de eliminacion directa,
// NADIE queda afuera al perder: todos juegan todas las rondas
// (salvo bye si el numero de jugadores activos es impar), y el
// campeon es quien mas puntos acumula, no quien "sobrevive". Reusa
// la MISMA forma de partido ({player1,player2,...,status}) que ya
// usa el bracket de eliminacion, asi Event.bracket no necesita un
// schema paralelo -- server.js solo necesita ramificar COMO se arma
// la siguiente ronda y CUANDO termina el torneo segun event.format.
// ================================================================

// Cuantas rondas hacen falta para un suizo con N jugadores -- formula
// estandar (log2 redondeado hacia arriba), con piso de 1 ronda.
function swissRoundsNeeded(playerCount) {
  return Math.max(1, Math.ceil(Math.log2(Math.max(2, playerCount))));
}

// Puntaje (1 por victoria, incluye byes) y pares que ya se enfrentaron,
// recalculados siempre desde bracket.rounds -- nunca se guarda un
// contador aparte que se pueda desincronizar.
function computeSwissScores(allPlayers, previousRounds) {
  const score = new Map(allPlayers.map((p) => [String(p.userId), 0]));
  const playedPairs = new Set();
  for (const round of previousRounds || []) {
    for (const m of round.matches || []) {
      const p1 = m.player1 ? String(m.player1) : null;
      const p2 = m.player2 ? String(m.player2) : null;
      if (p1 && p2) playedPairs.add([p1, p2].sort().join('|'));
      if (m.winner) {
        const w = String(m.winner);
        if (score.has(w)) score.set(w, (score.get(w) || 0) + 1);
      }
    }
  }
  return { score, playedPairs };
}

// Empareja la proxima ronda suiza: ordena por puntaje descendente y
// empareja de a pares consecutivos, prefiriendo un rival que todavia
// no haya enfrentado (evita reencuentros tempranos). Si a alguien no
// le queda ningun rival nuevo disponible, se acepta un reencuentro
// antes que dejarlo sin jugar -- mejor eso que un bye artificial con
// gente todavia disponible.
function generateSwissRound(allPlayers, previousRounds) {
  const { score, playedPairs } = computeSwissScores(allPlayers, previousRounds);
  const ranked = [...allPlayers].sort((a, b) => (score.get(String(b.userId)) || 0) - (score.get(String(a.userId)) || 0));

  const matches = [];
  const used = new Set();
  for (let i = 0; i < ranked.length; i++) {
    const p1 = ranked[i];
    const p1Id = String(p1.userId);
    if (used.has(p1Id)) continue;
    used.add(p1Id);

    let opponent = null;
    for (let j = i + 1; j < ranked.length; j++) {
      const p2 = ranked[j];
      if (used.has(String(p2.userId))) continue;
      const key = [p1Id, String(p2.userId)].sort().join('|');
      if (!playedPairs.has(key)) { opponent = p2; break; }
    }
    if (!opponent) {
      for (let j = i + 1; j < ranked.length; j++) {
        const p2 = ranked[j];
        if (!used.has(String(p2.userId))) { opponent = p2; break; }
      }
    }

    if (opponent) {
      used.add(String(opponent.userId));
      matches.push({
        player1: p1.userId, player2: opponent.userId,
        player1Name: p1.name, player2Name: opponent.name,
        winner: null, roomCode: null, status: 'ready',
      });
    } else {
      matches.push({
        player1: p1.userId, player2: null,
        player1Name: p1.name, player2Name: '',
        winner: p1.userId, roomCode: null, status: 'bye',
      });
    }
  }
  return { matches };
}

// Clasificacion final: puntaje descendente. Con un numero de rondas
// razonable para el tamaño del torneo (swissRoundsNeeded) los empates
// en primer lugar son infrecuentes; si ocurren, gana quien aparece
// primero en este orden (mismo criterio simple y documentado, sin
// desempate por rendimiento de rivales todavia).
function swissStandings(allPlayers, allRounds) {
  const { score } = computeSwissScores(allPlayers, allRounds);
  return [...allPlayers]
    .map((p) => ({ userId: p.userId, name: p.name, score: score.get(String(p.userId)) || 0 }))
    .sort((a, b) => b.score - a.score);
}

module.exports = {
  shuffle, pairUp, generateFirstRound, generateNextRound,
  swissRoundsNeeded, generateSwissRound, swissStandings,
};
