'use strict';

// QA de las reglas de captura de Damas (roadmap "OZAMA CHESS Y DAMAS
// - FASE PRO", seccion 36). La regla de oro: CAPTURAR es obligatorio,
// pero CUAL captura legal usar es SIEMPRE decision del jugador -- el
// motor (checkers-engine.js) nunca debe descartar una opcion legal ni
// elegir una por su cuenta. Estos casos prueban esa regla directo
// contra el motor, sin necesidad de servidor ni DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/checkers-engine.js');

function emptyBoard() {
  return Array.from({ length: E.SIZE }, () => new Array(E.SIZE).fill(null));
}

test('CASO 1: una sola captura disponible obliga a capturar', () => {
  const board = emptyBoard();
  board[4][4] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false };
  const moves = E.getLegalMovesForSquare(board, 4, 4);
  assert.equal(moves.length, 1, 'debe haber exactamente una secuencia legal');
  assert.equal(moves[0][0].capturedR, 3, 'la unica jugada legal debe ser la captura');
});

test('CASO 2: dos capturas disponibles desde la misma pieza -- se puede elegir cualquiera', () => {
  const board = emptyBoard();
  board[4][4] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false }; // aterriza en (2,2)
  board[3][5] = { color: 'b', king: false }; // aterriza en (2,6)
  const moves = E.getLegalMovesForSquare(board, 4, 4);
  assert.equal(moves.length, 2, 'deben existir 2 opciones de captura');
  const finals = moves.map((seq) => `${seq[0].toR},${seq[0].toC}`).sort();
  assert.deepEqual(finals, ['2,2', '2,6'], 'ambos destinos legales deben estar presentes');
});

test('CASO 3: tres capturas disponibles -- se puede elegir cualquiera', () => {
  // Peon (no dama) rodeado de enemigas en 3 de sus 4 diagonales de
  // captura (el peon captura hacia adelante Y hacia atras), cada una
  // con aterrizaje libre a 2 casillas. Un peon salta una distancia
  // fija (a diferencia de una dama, que podria "volar" y aterrizar en
  // varias casillas distintas detras de la misma pieza capturada,
  // complicando el conteo) -- asi cada direccion da exactamente 1
  // secuencia, sin ambiguedad de cuantas produce esta prueba.
  const board = emptyBoard();
  board[4][4] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false }; // NO -> aterriza en (2,2)
  board[3][5] = { color: 'b', king: false }; // NE -> aterriza en (2,6)
  board[5][3] = { color: 'b', king: false }; // SO -> aterriza en (6,2)
  const moves = E.getLegalMovesForSquare(board, 4, 4);
  assert.equal(moves.length, 3, 'deben existir 3 opciones de captura (una por cada enemiga alcanzable)');
});

test('CASO 4: dos piezas distintas pueden capturar -- se puede elegir cualquiera', () => {
  const board = emptyBoard();
  board[4][2] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false }; // capturable por (4,2)
  board[4][6] = { color: 'w', king: false };
  board[3][5] = { color: 'b', king: false }; // capturable por (4,6)
  const all = E.getAllLegalMoves(board, 'w');
  const origins = all.map((e) => `${e.r},${e.c}`).sort();
  assert.deepEqual(origins, ['4,2', '4,6'], 'ambas piezas deben figurar como origen legal de captura');
});

test('CASO 5: captura multiple obligatoria continua con la misma pieza', () => {
  const board = emptyBoard();
  board[4][4] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false }; // 1er salto: aterriza en (2,2)
  board[1][1] = { color: 'b', king: false }; // 2do salto obligatorio: aterriza en (0,0)
  const moves = E.getLegalMovesForSquare(board, 4, 4);
  assert.equal(moves.length, 1, 'con una sola continuacion posible, la secuencia es unica');
  assert.equal(moves[0].length, 2, 'la secuencia debe incluir los 2 saltos, no detenerse en el primero');
  assert.equal(moves[0][1].toR, 0);
  assert.equal(moves[0][1].toC, 0);
});

test('CASO 6: durante una captura multiple hay dos opciones -- el motor NO elige, expone ambas', () => {
  // Posicion confirmada por busqueda programada: una pieza blanca con
  // 4 negras en diamante tiene EXACTAMENTE 2 secuencias legales de 2
  // saltos, ambas terminan en la MISMA casilla (0,2) pero capturando
  // PARES DE PIEZAS DISTINTOS -- exactamente el escenario que el
  // roadmap describe como "situacion B" (seccion 18-19).
  const board = emptyBoard();
  board[4][2] = { color: 'w', king: false };
  board[1][1] = { color: 'b', king: false };
  board[1][3] = { color: 'b', king: false };
  board[3][1] = { color: 'b', king: false };
  board[3][3] = { color: 'b', king: false };

  const moves = E.getLegalMovesForSquare(board, 4, 2);
  assert.equal(moves.length, 2, 'deben sobrevivir 2 secuencias legales de igual longitud');

  const finals = moves.map((seq) => `${seq[seq.length - 1].toR},${seq[seq.length - 1].toC}`);
  assert.equal(finals[0], '0,2');
  assert.equal(finals[1], '0,2');

  // La parte que de verdad importa: aunque el destino final coincide,
  // las piezas CAPTURADAS son distintas -- si el sistema colapsara
  // esto a "la primera que aparece" (como hacia el cliente antes de
  // este fix), el jugador perderia la posibilidad real de elegir cual
  // par de piezas enemigas sobrevive.
  const capturedSets = moves.map((seq) => seq.map((s) => `${s.capturedR},${s.capturedC}`).sort().join('|'));
  assert.notEqual(capturedSets[0], capturedSets[1], 'las dos opciones deben capturar piezas distintas, no solo en distinto orden');
});

test('CASO 7: movimiento sin captura cuando existe captura obligatoria -- rechazado', () => {
  const board = emptyBoard();
  // Pieza A tiene captura obligatoria disponible.
  board[4][4] = { color: 'w', king: false };
  board[3][3] = { color: 'b', king: false };
  // Pieza B (misma color) NO tiene captura, solo un movimiento simple.
  board[6][6] = { color: 'w', king: false };
  const movesForB = E.getLegalMovesForSquare(board, 6, 6);
  assert.equal(movesForB.length, 0, 'con captura obligatoria en otra pieza, esta pieza no puede moverse sin capturar');
});

test('CASO 8: movimiento ilegal (geometria que no corresponde a ninguna jugada legal) -- rechazado', () => {
  const board = emptyBoard();
  board[4][4] = { color: 'w', king: false };
  const legal = E.getLegalMovesForSquare(board, 4, 4);
  // Intento fabricado: mover 3 casillas en linea recta (no diagonal),
  // como haria un cliente comprometido o un bug de UI.
  const fakeMove = [{ toR: 4, toC: 1, capturedR: -1, capturedC: -1 }];
  const matched = legal.some((seq) => JSON.stringify(seq) === JSON.stringify(fakeMove));
  assert.equal(matched, false, 'una jugada con geometria invalida nunca debe aparecer entre las legales');
});
