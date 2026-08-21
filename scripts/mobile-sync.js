'use strict';

const { existsSync, lstatSync, readFileSync, readdirSync, unlinkSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', 'npx cap sync android']
  : ['cap', 'sync', 'android'];

const sync = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: false,
});

if (sync.error) {
  console.error(sync.error.message);
  process.exit(1);
}
if (sync.status !== 0) process.exit(sync.status ?? 1);

const assetsRoot = join(root, 'android', 'app', 'src', 'main', 'assets');
let materialized = 0;

function materializeFiles(directory) {
  if (!existsSync(directory)) return;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      materializeFiles(filePath);
      continue;
    }
    if (!entry.isFile() && !lstatSync(filePath).isFile()) continue;

    const contents = readFileSync(filePath);
    unlinkSync(filePath);
    writeFileSync(filePath, contents);
    materialized += 1;
  }
}

materializeFiles(assetsRoot);
console.log(`[mobile] ${materialized} assets materializados para Gradle.`);
