const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..');
const bundledSdk = join(root, '.tools', 'android-sdk');
const androidHome = existsSync(join(bundledSdk, 'platform-tools'))
  ? bundledSdk
  : process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

if (!androidHome || !existsSync(join(androidHome, 'platform-tools', 'adb.exe'))) {
  console.error('adb no esta disponible. Configura ANDROID_HOME o prepara .tools/android-sdk.');
  process.exit(1);
}

if (!existsSync(apk)) {
  console.error('El APK debug no existe. Ejecuta npm run android:build:debug primero.');
  process.exit(1);
}

const adb = join(androidHome, 'platform-tools', 'adb.exe');
const devicesResult = spawnSync(adb, ['devices'], { encoding: 'utf8', shell: false });
const devices = (devicesResult.stdout || '')
  .split(/\r?\n/)
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === 'device');

if (devices.length === 0) {
  console.error('No hay un Android autorizado. Conecta el telefono, activa Depuracion USB y acepta su huella RSA.');
  process.exit(1);
}

if (devices.length > 1) {
  console.error('Hay varios dispositivos conectados. Deja solo uno para evitar instalar en el equipo incorrecto.');
  process.exit(1);
}

console.log(`Instalando OZAMA CHESS en ${devices[0][0]}...`);
const install = spawnSync(adb, ['-s', devices[0][0], 'install', '-r', apk], {
  stdio: 'inherit',
  shell: false
});

if (install.error) {
  console.error(install.error.message);
  process.exit(1);
}

process.exit(install.status ?? 1);
