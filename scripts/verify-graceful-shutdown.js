'use strict';

// Prueba de "Resiliencia" (Fase 27 del roadmap "OZAMA PRO"): la
// auditoria encontro que server.js no manejaba SIGTERM en absoluto --
// Render manda esa señal antes de CADA deploy/reinicio, y sin un
// handler Node mata el proceso de una vez: cierra todos los sockets de
// golpe (corte TCP, no un disconnect limpio) y puede cortar una
// escritura a Mongo a medio hacer. El estado de las salas vive en
// memoria, asi que un reinicio SIEMPRE pierde las partidas activas --
// eso no lo arregla un apagado ordenado. Lo que SI arregla: que cada
// cliente conectado reciba un 'disconnect' real de Socket.IO (dispara
// el overlay de "reconectando" que ya existe desde la Fase 14, en vez
// de quedar colgado hasta que el navegador detecte el corte solo) y
// que Mongoose cierre limpio.
//
// NOTA de plataforma: en Windows, `child.kill('SIGTERM')` desde un
// proceso padre de Node NO entrega una señal real -- termina el
// proceso hijo de una (documentado, limitacion de Node en Windows).
// Render corre Linux, donde SIGTERM real si llega. Para probar la
// logica del handler en cualquier plataforma sin depender de ese
// detalle del SO, este script arranca server.js DENTRO del mismo
// proceso (via require) y dispara `process.emit('SIGTERM')`
// directamente -- exactamente lo que ejecuta el handler cuando el SO
// SI entrega la señal de verdad, sin la incertidumbre de entrega
// entre procesos/SO.
//
// Verifica, contra un server.js real (in-process) y una Mongo aislada
// y temporal (nunca produccion):
//
//   - con un cliente Socket.IO real conectado, SIGTERM hace que ese
//     cliente reciba un 'disconnect' de verdad;
//   - el handler llama process.exit(0) (apagado ordenado, no
//     process.exit(1) de la salvaguarda de emergencia) bien antes de
//     los 8 segundos de margen;
//   - Mongoose queda desconectado al final del apagado.
//
// Uso: node scripts/verify-graceful-shutdown.js

require('dotenv').config();
const { createIsolatedMongoEnv } = require('./test-db-guard');

const port = Number(process.env.OZAMA_SHUTDOWN_TEST_PORT || 3240);
const baseUrl = `http://127.0.0.1:${port}`;
const isolatedMongo = createIsolatedMongoEnv({ prefix: 'ozama_test_shutdown' });

process.env.PORT = String(port);
Object.assign(process.env, isolatedMongo.env);
process.env.JWT_SECRET = process.env.JWT_SECRET || 'graceful-shutdown-test-secret-at-least-32c';
process.env.APP_ORIGINS = `${baseUrl},http://localhost:${port}`;
process.env.GOOGLE_WEB_CLIENT_ID = '';
process.env.GOOGLE_ANDROID_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_IDS = '';
process.env.NODE_ENV = 'test';

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function assert(cond, message) { if (!cond) throw new Error(`ASSERTION FAILED: ${message}`); }

// Intercepta process.exit -- server.js lo llama de verdad al terminar
// el apagado ordenado, pero como server.js corre DENTRO de este mismo
// proceso de prueba, dejar que se ejecute de verdad mataria el script
// de prueba a mitad de las aserciones.
let exitCalledWith = null;
const realExit = process.exit.bind(process);
process.exit = (code) => { exitCalledWith = code; };

async function waitForServer() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health/db`, { cache: 'no-store' });
      if (res.ok) return;
    } catch (_) {}
    await wait(300);
  }
  throw new Error('server did not become ready');
}

async function main() {
  require('../server.js');
  await waitForServer();
  console.log(`DB=${isolatedMongo.dbName}`);

  const { io } = require('socket.io-client');
  const client = io(baseUrl, { transports: ['websocket'], reconnection: false, forceNew: true });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el cliente nunca conecto')), 8000);
    client.once('connect', () => { clearTimeout(timer); resolve(); });
    client.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
  });
  console.log('Cliente Socket.IO conectado contra el server real.');

  const disconnectPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("el cliente nunca recibio un disconnect real -- SIGTERM no esta cerrando los sockets de forma ordenada")), 6000);
    client.once('disconnect', (reason) => { clearTimeout(timer); resolve(reason); });
  });

  const mongoose = require('mongoose');
  assert(mongoose.connection.readyState === 1, 'Mongoose deberia estar conectado antes del apagado');

  const t0 = Date.now();
  process.emit('SIGTERM');

  const disconnectReason = await disconnectPromise;
  console.log(`SIGTERM -> el cliente recibio 'disconnect' (motivo: ${disconnectReason}) en vez de quedar colgado.`);

  const exitDeadline = Date.now() + 5000;
  while (exitCalledWith === null && Date.now() < exitDeadline) await wait(30);
  const elapsed = Date.now() - t0;

  assert(exitCalledWith === 0, `el apagado deberia llamar process.exit(0) (camino ordenado), llamo con ${exitCalledWith}`);
  assert(elapsed < 8000, `el apagado tardo ${elapsed}ms -- deberia ser bien mas rapido que la salvaguarda de emergencia de 8s`);
  console.log(`El handler de SIGTERM cerro todo en ${elapsed}ms y llamo process.exit(0) (no la salvaguarda de emergencia).`);

  assert(mongoose.connection.readyState === 0, `Mongoose deberia quedar desconectado tras el apagado, readyState=${mongoose.connection.readyState}`);
  console.log('Mongoose quedo desconectado limpio, sin dejar la conexion colgando.');

  process.exit = realExit;
  console.log('\n✅ GRACEFUL_SHUTDOWN_OK');
  realExit(0);
}

main().catch((err) => {
  process.exit = realExit;
  console.error('\n❌ GRACEFUL_SHUTDOWN_FAILED:', err.message);
  realExit(1);
});
