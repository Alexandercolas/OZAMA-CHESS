'use strict';

// Catalogo central de ritmos de tiempo (Fase 2 del roadmap "OZAMA PRO
// - FASE FINAL": Blitz). Un solo lugar para Ajedrez y Damas -- agregar
// un ritmo nuevo es sumar una entrada aca, nunca tocar server.js ni
// duplicar el numero en cada sitio donde se crea una sala.
//
// "key" es el mismo formato libre que Event.timeControl ya usaba antes
// de esta fase ("3+0", "10+0") -- los torneos recurrentes
// (services/recurringTournaments.js) ya escriben exactamente estas
// claves, asi que empiezan a funcionar de verdad sin migrar nada.
const TIME_CONTROLS = [
  { key: '1+0',  label: '1+0',  minutes: 1,  incrementSec: 0, category: 'bullet' },
  { key: '2+1',  label: '2+1',  minutes: 2,  incrementSec: 1, category: 'blitz' },
  { key: '3+0',  label: '3+0',  minutes: 3,  incrementSec: 0, category: 'blitz' },
  { key: '5+0',  label: '5+0',  minutes: 5,  incrementSec: 0, category: 'blitz' },
  { key: '10+0', label: '10+0', minutes: 10, incrementSec: 0, category: 'rapida' },
];

// Mantiene el comportamiento de SIEMPRE (antes de esta fase, todas las
// partidas eran 10 minutos sin incremento) como default -- elegir no
// pasar ritmo de tiempo en ningun flujo viejo no cambia nada.
const DEFAULT_TIME_CONTROL_KEY = '10+0';

const TIME_CONTROL_MAP = new Map(TIME_CONTROLS.map((t) => [t.key, t]));
const TIME_CONTROL_KEYS = TIME_CONTROLS.map((t) => t.key);

function timeControlByKey(key) {
  return TIME_CONTROL_MAP.get(key) || TIME_CONTROL_MAP.get(DEFAULT_TIME_CONTROL_KEY);
}

function isValidTimeControl(key) {
  return TIME_CONTROL_MAP.has(key);
}

function initialMsFor(key) {
  return timeControlByKey(key).minutes * 60000;
}

function incrementMsFor(key) {
  return timeControlByKey(key).incrementSec * 1000;
}

module.exports = {
  TIME_CONTROLS,
  TIME_CONTROL_KEYS,
  DEFAULT_TIME_CONTROL_KEY,
  timeControlByKey,
  isValidTimeControl,
  initialMsFor,
  incrementMsFor,
};
