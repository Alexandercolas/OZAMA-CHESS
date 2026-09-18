'use strict';

// Regresion general (Fase 36 del roadmap "OZAMA PRO", bloque de QA):
// cada fase anterior agrego su propio script scripts/verify-*.js que
// prueba SU feature contra un server.js real y una Mongo aislada -- pero
// a lo largo de 35 fases, cada una solo re-corria un par de esos
// scripts como "spot check" al tocar codigo compartido. Nunca se habian
// corrido TODOS juntos contra el codigo actual. Este runner lo hace en
// un solo comando: los ejecuta uno por uno (cada uno levanta su propio
// server en su propio puerto, asi que en secuencia no se pisan), mide
// cuanto tarda cada uno y resume al final cuales pasaron/fallaron.
//
// Uso:
//   node scripts/run-all-verifications.js              # todos
//   node scripts/run-all-verifications.js chat damas   # solo los que contengan esas palabras
//
// Sale con codigo 1 si CUALQUIERA falla -- util como paso final antes
// de un deploy grande o de un cierre de fase.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const scriptsDir = __dirname;
const filters = process.argv.slice(2).map((f) => f.toLowerCase());
const PER_SCRIPT_TIMEOUT_MS = 180_000;

const all = fs.readdirSync(scriptsDir)
  .filter((f) => /^verify-.*\.js$/.test(f))
  .sort();
const selected = filters.length ? all.filter((f) => filters.some((flt) => f.toLowerCase().includes(flt))) : all;

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const proc = spawn(process.execPath, [path.join(scriptsDir, file)], {
      cwd: path.resolve(scriptsDir, '..'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    proc.stdout.on('data', (c) => out.push(c.toString()));
    proc.stderr.on('data', (c) => out.push(c.toString()));
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, PER_SCRIPT_TIMEOUT_MS);
    proc.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ file, code, signal, ms: Date.now() - started, output: out.join('') });
    });
  });
}

(async () => {
  console.log(`Corriendo ${selected.length} scripts de verificacion (de ${all.length} totales)...\n`);
  const results = [];
  for (const file of selected) {
    process.stdout.write(`▶ ${file} ... `);
    const r = await runOne(file);
    const ok = r.code === 0;
    console.log(`${ok ? 'OK' : 'FALLO'} (${(r.ms / 1000).toFixed(1)}s)`);
    if (!ok) {
      const tail = r.output.trim().split(/\r?\n/).slice(-15).join('\n');
      console.log(`--- ultimas lineas de ${file} ---\n${tail}\n--- fin ---`);
    }
    results.push(r);
  }

  const failed = results.filter((r) => r.code !== 0);
  const totalSec = results.reduce((s, r) => s + r.ms, 0) / 1000;
  console.log(`\n${results.length - failed.length}/${results.length} pasaron en ${totalSec.toFixed(0)}s.`);
  if (failed.length) {
    console.log('Fallaron: ' + failed.map((r) => r.file).join(', '));
    process.exit(1);
  }
  console.log('✅ REGRESION_GENERAL_OK');
})();
