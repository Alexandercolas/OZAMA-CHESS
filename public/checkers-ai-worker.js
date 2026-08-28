'use strict';

// Web Worker para el bot de Damas -- corre la busqueda de minimax en
// un hilo aparte para que profundidades fuertes (nivel Alcazar, ~10
// plies, hasta varios segundos en el peor caso) no congelen la
// pestana ni bloqueen la animacion del tablero mientras "piensa".
//
// Mismo checkers-engine.js/checkers-ai.js que usa el hilo principal
// (importados tal cual via importScripts, sin duplicar la logica).

importScripts('/checkers-engine.js', '/checkers-ai.js');

self.onmessage = (event) => {
  const { board, color, depth, requestId } = event.data || {};
  try {
    const move = self.OzamaCheckersAI.chooseMove(board, color, depth);
    self.postMessage({ requestId, move });
  } catch (error) {
    self.postMessage({ requestId, error: error?.message || 'Error en el worker del bot.' });
  }
};
