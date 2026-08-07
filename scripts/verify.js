'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const failures = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'android') return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

const javascriptFiles = [
  path.join(root, 'server.js'),
  ...walk(path.join(root, 'config')),
  ...walk(path.join(root, 'middleware')),
  ...walk(path.join(root, 'models')),
  ...walk(path.join(root, 'routes')),
  ...walk(path.join(root, 'public')),
  ...walk(path.join(root, 'scripts')),
  ...walk(path.join(root, 'tests')),
].filter((file) => file.endsWith('.js'));

for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${relative(file)}: ${result.stderr.trim()}`);
}

for (const file of walk(path.join(root, 'public')).filter((item) => item.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi);
  let index = 0;

  for (const match of scripts) {
    index += 1;
    const attributes = match[1] || '';
    const source = match[2] || '';
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;

    try {
      if (/application\/ld\+json/i.test(attributes)) JSON.parse(source);
      else new vm.Script(source, { filename: `${relative(file)}#script-${index}` });
    } catch (error) {
      failures.push(`${relative(file)} script ${index}: ${error.message}`);
    }
  }
}

for (const jsonFile of ['package.json', 'capacitor.config.json', 'public/manifest.webmanifest']) {
  try {
    JSON.parse(fs.readFileSync(path.join(root, jsonFile), 'utf8'));
  } catch (error) {
    failures.push(`${jsonFile}: ${error.message}`);
  }
}

for (const asset of [
  'public/favicon.png',
  'public/icon-192.png',
  'public/icon-512.png',
  'public/apple-touch-icon.png',
  'public/assets/brand/ozama-hero-brutal.jpg',
]) {
  const file = path.join(root, asset);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) failures.push(`${asset}: archivo faltante o vacio`);
}

if (failures.length) {
  console.error('\nOZAMA verification failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`OZAMA verification passed: ${javascriptFiles.length} JS files and public HTML validated.`);
