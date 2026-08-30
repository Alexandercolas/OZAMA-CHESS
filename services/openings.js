'use strict';

// Catalogo de aperturas (Fase 9 del roadmap PRO). Antes vivia solo
// como una lista privada adentro de routes/user.js, usada nomas para
// detectar el nombre de apertura en las estadisticas avanzadas.
// Se movio aca (mejora, no duplica) para poder reusar el MISMO
// catalogo tambien en el explorador publico de aperturas
// (routes/openings.js + public/openings.html), sin mantener dos
// listas separadas que se puedan desincronizar.
//
// Las jugadas son SAN de la linea principal, tal como ya se guardaban
// en el PGN (mismo formato que produce public/script.js). No se
// inventan variantes ni teoria mas alla de lo que cualquier libro de
// aperturas basico ya documenta.
const OPENING_BOOK = [
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], name: 'Ruy Lopez', family: 'e4', description: 'Una de las aperturas mas antiguas y respetadas. El alfil blanco presiona al caballo que defiende el peon e5, buscando una ventaja posicional duradera.', finalRows: ["r.bqkbnr","pppp.ppp","..n.....",".B..p...","....P...",".....N..","PPPP.PPP","RNBQK..R"] },
  { moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], name: 'Italiana', family: 'e4', description: 'Desarrollo rapido apuntando al punto debil f7. Es una de las aperturas mas naturales para aprender los principios del ajedrez abierto.', finalRows: ["r.bqkbnr","pppp.ppp","..n.....","....p...","..B.P...",".....N..","PPPP.PPP","RNBQK..R"] },
  { moves: ['e4', 'e5', 'Nf3', 'Nf6'], name: 'Petrov', family: 'e4', description: 'Defensa simetrica y solida: en vez de defender el peon e5, las negras contraatacan el peon e4 de inmediato.', finalRows: ["rnbqkb.r","pppp.ppp",".....n..","....p...","....P...",".....N..","PPPP.PPP","RNBQKB.R"] },
  { moves: ['e4', 'e5', 'Nc3'], name: 'Vienesa', family: 'e4', description: 'Desarrolla el caballo antes que el alfil, dejando abiertas varias transposiciones y una posible f4 mas adelante.', finalRows: ["rnbqkbnr","pppp.ppp","........","....p...","....P...","..N.....","PPPP.PPP","R.BQKBNR"] },
  { moves: ['e4', 'e5'], name: 'Apertura Abierta (1.e4 e5)', family: 'e4', description: 'La respuesta simetrica clasica: ambos bandos pelean el centro de igual a igual desde la primera jugada.', finalRows: ["rnbqkbnr","pppp.ppp","........","....p...","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'c5'], name: 'Siciliana', family: 'e4', description: 'La defensa mas jugada al maximo nivel. Las negras buscan un juego desequilibrado y contraataque por el flanco de dama.', finalRows: ["rnbqkbnr","pp.ppppp","........","..p.....","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'e6'], name: 'Francesa', family: 'e4', description: 'Estructura solida pero algo pasiva al inicio: las negras ceden espacio en el centro a cambio de una posicion muy resistente.', finalRows: ["rnbqkbnr","pppp.ppp","....p...","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'c6'], name: 'Caro-Kann', family: 'e4', description: 'Similar en espiritu a la Francesa pero sin encerrar al alfil de dama negro, una de las defensas mas solidas que existen.', finalRows: ["rnbqkbnr","pp.ppppp","..p.....","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'd5'], name: 'Escandinava', family: 'e4', description: 'Las negras desafian el centro de inmediato, aceptando perder un tiempo para sacar la dama pronto a cambio de simplicidad.', finalRows: ["rnbqkbnr","ppp.pppp","........","...p....","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'd6'], name: 'Pirc / Moderna', family: 'e4', description: 'Las negras ceden el centro a proposito para golpearlo despues con las piezas, en vez de con peones.', finalRows: ["rnbqkbnr","ppp.pppp","...p....","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'Nf6'], name: 'Alekhine', family: 'e4', description: 'Provoca a las blancas a avanzar peones centrales para atacarlos despues, en una apertura muy dinamica.', finalRows: ["rnbqkb.r","pppppppp",".....n..","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4', 'g6'], name: 'Moderna', family: 'e4', description: 'Fianchetto inmediato del alfil de rey negro, dejando que las blancas ocupen el centro para atacarlo mas tarde.', finalRows: ["rnbqkbnr","pppppp.p","......p.","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['e4'], name: 'Apertura de Rey (1.e4)', family: 'e4', description: 'La jugada mas popular de la historia: ocupa el centro y abre la diagonal del alfil y la salida de la dama.', finalRows: ["rnbqkbnr","pppppppp","........","........","....P...","........","PPPP.PPP","RNBQKBNR"] },
  { moves: ['d4', 'd5', 'c4', 'e6'], name: 'Gambito de Dama Rehusado', family: 'd4', description: 'Las negras no capturan el peon c4 y en cambio refuerzan el centro, una de las defensas mas solidas contra 1.d4.', finalRows: ["rnbqkbnr","ppp..ppp","....p...","...p....","..PP....","........","PP..PPPP","RNBQKBNR"] },
  { moves: ['d4', 'd5', 'c4'], name: 'Gambito de Dama', family: 'd4', description: 'No es un gambito real (el peon se recupera casi siempre): busca desviar al peon d5 para dominar el centro.', finalRows: ["rnbqkbnr","ppp.pppp","........","...p....","..PP....","........","PP..PPPP","RNBQKBNR"] },
  { moves: ['d4', 'Nf6', 'c4', 'g6'], name: 'India del Rey', family: 'd4', description: 'Las negras ceden el centro con la idea de atacarlo mas tarde con f5 o e5, tras un fianchetto de rey.', finalRows: ["rnbqkb.r","pppppp.p",".....np.","........","..PP....","........","PP..PPPP","RNBQKBNR"] },
  { moves: ['d4', 'Nf6', 'c4', 'e6'], name: 'Nimzoindia / India', family: 'd4', description: 'El alfil negro clava el caballo en c3 desde b4, generando presion posicional desde muy temprano.', finalRows: ["rnbqkb.r","pppp.ppp","....pn..","........","..PP....","........","PP..PPPP","RNBQKBNR"] },
  { moves: ['d4', 'f5'], name: 'Holandesa', family: 'd4', description: 'Las negras buscan juego activo por el flanco de rey desde el primer movimiento, a costa de debilitar su propio rey.', finalRows: ["rnbqkbnr","ppppp.pp","........",".....p..","...P....","........","PPP.PPPP","RNBQKBNR"] },
  { moves: ['d4', 'd5'], name: 'Apertura de Dama Cerrada', family: 'd4', description: 'Estructura simetrica y estrategica, tipica de partidas largas con planes a mediano plazo.', finalRows: ["rnbqkbnr","ppp.pppp","........","...p....","...P....","........","PPP.PPPP","RNBQKBNR"] },
  { moves: ['d4', 'Nf6'], name: 'Defensa India', family: 'd4', description: 'Las negras desarrollan el caballo antes de comprometer los peones centrales, manteniendo flexibilidad.', finalRows: ["rnbqkb.r","pppppppp",".....n..","........","...P....","........","PPP.PPPP","RNBQKBNR"] },
  { moves: ['d4'], name: 'Apertura de Dama (1.d4)', family: 'd4', description: 'La segunda jugada mas popular: ocupa el centro de forma mas solida que 1.e4, con menos jugadas tacticas tempranas.', finalRows: ["rnbqkbnr","pppppppp","........","........","...P....","........","PPP.PPPP","RNBQKBNR"] },
  { moves: ['Nf3'], name: 'Apertura Reti', family: 'flanco', description: 'Desarrollo flexible por las piezas, dejando para mas adelante la decision sobre que peon central avanzar.', finalRows: ["rnbqkbnr","pppppppp","........","........","........",".....N..","PPPPPPPP","RNBQKB.R"] },
  { moves: ['c4'], name: 'Apertura Inglesa', family: 'flanco', description: 'Controla d5 desde el flanco, con transposiciones posibles a estructuras de 1.d4 o un juego totalmente propio.', finalRows: ["rnbqkbnr","pppppppp","........","........","..P.....","........","PP.PPPPP","RNBQKBNR"] },
  { moves: ['g3'], name: 'Fianchetto', family: 'flanco', description: 'El alfil de rey blanco se prepara para salir a g2, una apertura muy posicional y de bajo riesgo.', finalRows: ["rnbqkbnr","pppppppp","........","........","........","......P.","PPPPPP.P","RNBQKBNR"] },
  { moves: ['b3'], name: 'Nimzowitsch-Larsen', family: 'flanco', description: 'Fianchetto del alfil de dama, presionando la diagonal larga desde el primer movimiento.', finalRows: ["rnbqkbnr","pppppppp","........","........","........",".P......","P.PPPPPP","RNBQKBNR"] },
  { moves: ['f4'], name: 'Gambito Bird', family: 'flanco', description: 'Apertura agresiva y poco comun que busca control del centro desde el flanco de rey.', finalRows: ["rnbqkbnr","pppppppp","........","........",".....P..","........","PPPPP.PP","RNBQKBNR"] },
];

// Version publica del catalogo, ordenada por familia para el
// explorador (routes/openings.js / public/openings.html).
function listOpenings() {
  return OPENING_BOOK.map(({ moves, name, family, description, finalRows }) => ({ moves, name, family, description, finalRows }));
}

// Detecta el nombre de apertura a partir de las primeras jugadas de
// un PGN en texto (mismo formato que ya genera public/script.js).
// Sin cambios de comportamiento respecto a como vivia en routes/user.js.
function detectOpening(pgnText) {
  const tokens = String(pgnText || '')
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .slice(0, 6);
  if (!tokens.length) return null;
  let best = null;
  for (const entry of OPENING_BOOK) {
    if (entry.moves.length > tokens.length) continue;
    let ok = true;
    for (let i = 0; i < entry.moves.length; i++) {
      if (tokens[i] !== entry.moves[i]) { ok = false; break; }
    }
    if (ok && (!best || entry.moves.length > best.moves.length)) best = entry;
  }
  return best ? best.name : null;
}

module.exports = { OPENING_BOOK, listOpenings, detectOpening };
