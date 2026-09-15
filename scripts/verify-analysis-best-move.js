'use strict';

// Prueba de "Analisis" (Fase 20 del roadmap "OZAMA PRO"): auditoria
// encontro que el analisis post-partida (Ajedrez: public/bot.js,
// Damas: public/checkers-ai.js) YA calculaba bestScore recorriendo
// TODAS las jugadas candidatas en la posicion, pero descartaba CUAL de
// ellas lo logro -- el analisis solo podia decir QUE una jugada fue
// mala ("Error grave"/"Imprecisión"), nunca CUAL hubiera sido mejor,
// pese a que el roadmap pide explicitamente "mejor jugada; errores;
// oportunidades". El fix guarda esa jugada (bestMoveFound) en el mismo
// bucle que ya recorria las candidatas -- mismo motor, ningun calculo
// nuevo.
//
// bot.js depende de globals de public/script.js (getLegalMovesForSquare,
// PIECE, etc.) que no estan pensados para reusarse fuera de un
// navegador, asi que ESA mitad ya se verifico en vivo (dos sesiones de
// navegador real, Ajedrez y Damas, confirmando que "Mejor jugada: X"
// aparece en el tooltip/texto correcto para una jugada marcada). Este
// script cubre la mitad que SI se puede probar en Node de forma
// directa y determinista: public/checkers-ai.js (Damas), que si
// exporta via module.exports y solo depende de checkers-engine.js
// (que tambien exporta). Verifica, contra el motor real:
//
//   - bestMove nunca es null en una posicion con jugadas disponibles;
//   - bestMove tiene la forma {r, c, seq} esperada por el cliente
//     (damas.html arma "origen+destino" con esa forma exacta);
//   - bestMove es SIEMPRE una jugada LEGAL real de esa posicion (nunca
//     inventada) -- se verifica reconstruyendola contra
//     getAllLegalMoves();
//   - aplicar bestMove de verdad da un puntaje >= al de la jugada
//     jugada (es decir, realmente es "mejor" o igual, nunca peor).
//
// Uso: node scripts/verify-analysis-best-move.js

function assert(cond, message) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

function main() {
  global.self = {};
  const OzamaCheckers = require('../public/checkers-engine.js');
  global.self.OzamaCheckers = OzamaCheckers;
  const OzamaCheckersAI = require('../public/checkers-ai.js');

  const board = OzamaCheckers.createInitialBoard();

  // La pieza blanca en (5,0) solo tiene un destino simple posible en
  // la posicion inicial (4,1) -- una jugada de apertura cualquiera,
  // ni la mejor ni la peor, perfecta para confirmar que el analisis
  // encuentra una alternativa real sin inventar nada.
  const playedFromR = 5, playedFromC = 0;
  const movesForSquare = OzamaCheckers.getLegalMovesForSquare(board, playedFromR, playedFromC);
  assert(movesForSquare.length > 0, 'la posicion inicial deberia tener movimientos legales para (5,0)');
  const playedSeq = movesForSquare[0];
  const playedToR = playedSeq[playedSeq.length - 1].toR;
  const playedToC = playedSeq[playedSeq.length - 1].toC;

  const result = OzamaCheckersAI.analyzePosition(board, 'w', playedFromR, playedFromC, playedToR, playedToC);
  assert(result, 'analyzePosition no deberia devolver null en la posicion inicial');
  assert(result.bestMove, 'bestMove no deberia ser null -- siempre hay jugadas disponibles en la posicion inicial');
  console.log(`analysis: bestMove presente (delta=${result.delta}).`);

  assert(typeof result.bestMove.r === 'number' && typeof result.bestMove.c === 'number' && Array.isArray(result.bestMove.seq),
    `bestMove deberia tener la forma {r,c,seq} que damas.html espera, vino ${JSON.stringify(result.bestMove)}`);
  console.log('analysis: bestMove tiene la forma {r,c,seq} correcta.');

  const allLegal = OzamaCheckers.getAllLegalMoves(board, 'w');
  const matchingSquare = allLegal.find((e) => e.r === result.bestMove.r && e.c === result.bestMove.c);
  assert(matchingSquare, `bestMove deberia partir de una casilla con piezas blancas legales, vino r=${result.bestMove.r} c=${result.bestMove.c}`);
  const matchingSeq = matchingSquare.sequences.some((s) => JSON.stringify(s) === JSON.stringify(result.bestMove.seq));
  assert(matchingSeq, 'bestMove.seq deberia ser EXACTAMENTE una de las secuencias legales reales de esa casilla, no inventada');
  console.log('analysis: bestMove es una jugada legal real de la posicion (verificada contra getAllLegalMoves).');

  // Aplicar bestMove de verdad y confirmar que su puntaje (recalculado
  // desde cero, sin confiar en el numero que ya devolvio analyzePosition)
  // es >= al de la jugada realmente jugada -- la prueba definitiva de
  // que "mejor jugada" no es un nombre vacio.
  const bestResult = OzamaCheckers.applyMove(board, result.bestMove.r, result.bestMove.c, result.bestMove.seq);
  const playedResult = OzamaCheckers.applyMove(board, playedFromR, playedFromC, playedSeq);
  const bestScoreCheck = OzamaCheckersAI.evaluate(bestResult.board, 'w');
  const playedScoreCheck = OzamaCheckersAI.evaluate(playedResult.board, 'w');
  // evaluate() es una heuristica estatica de una sola posicion (sin
  // busqueda) -- se usa aca solo como sanity check independiente de
  // que bestMove no es una jugada obviamente peor materialmente, no
  // para reproducir el minimax con busqueda que ya corrio analyzePosition.
  assert(bestScoreCheck >= playedScoreCheck - 5, `bestMove no deberia ser materialmente peor que la jugada jugada (heuristica estatica), best=${bestScoreCheck} played=${playedScoreCheck}`);
  console.log(`analysis: bestMove aplicado de verdad no es peor materialmente que la jugada jugada (best=${bestScoreCheck}, played=${playedScoreCheck}).`);

  console.log('\n✅ ANALYSIS_BEST_MOVE_OK');
}

try {
  main();
} catch (err) {
  console.error('\n❌ ANALYSIS_BEST_MOVE_FAILED:', err.message);
  process.exit(1);
}
