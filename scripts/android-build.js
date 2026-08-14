const { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = resolve(__dirname, '..');
const androidRoot = join(root, 'android');

function findDirectoryContaining(base, relativeTarget) {
  if (!existsSync(base)) return '';

  const candidates = [base, ...readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name))];

  return candidates.find((candidate) => existsSync(join(candidate, relativeTarget))) || '';
}

const bundledJdk = findDirectoryContaining(join(root, '.tools', 'jdk21'), join('bin', 'java.exe'));
const javaHome = bundledJdk || process.env.JAVA_HOME;
const bundledSdk = join(root, '.tools', 'android-sdk');
const androidHome = existsSync(join(bundledSdk, 'platforms'))
  ? bundledSdk
  : process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;

if (!javaHome || !existsSync(join(javaHome, 'bin', 'java.exe'))) {
  console.error('Java 21 no esta disponible. Instala JDK 21 o prepara .tools/jdk21.');
  process.exit(1);
}

const javaVersion = spawnSync(join(javaHome, 'bin', 'java.exe'), ['--version'], {
  encoding: 'utf8',
  shell: false
});
const versionOutput = `${javaVersion.stdout || ''}\n${javaVersion.stderr || ''}`;
const majorVersion = Number(versionOutput.match(/(?:openjdk|java)\s+(\d+)/i)?.[1] || 0);
if (javaVersion.status !== 0 || majorVersion < 21) {
  console.error('Capacitor 8 requiere JDK 21 o superior para compilar Android.');
  process.exit(1);
}

if (!androidHome || !existsSync(join(androidHome, 'platforms', 'android-36'))) {
  console.error('Android SDK API 36 no esta disponible. Configura ANDROID_HOME o prepara .tools/android-sdk.');
  process.exit(1);
}

const propertiesPath = join(androidRoot, 'local.properties');
const escapedSdkPath = androidHome.replace(/\\/g, '\\\\').replace(':', '\\:');
writeFileSync(propertiesPath, `sdk.dir=${escapedSdkPath}\n`, 'utf8');

const buildMode = process.argv[2] || 'debug';
const signedRelease = buildMode === 'signed';
let uploadStoreFile = '';
if (signedRelease) {
  const signingVariables = [
    'OZAMA_UPLOAD_STORE_FILE',
    'OZAMA_UPLOAD_STORE_PASSWORD',
    'OZAMA_UPLOAD_KEY_ALIAS',
    'OZAMA_UPLOAD_KEY_PASSWORD',
  ];
  const missing = signingVariables.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Faltan variables privadas de firma: ${missing.join(', ')}`);
    process.exit(1);
  }
  uploadStoreFile = resolve(process.env.OZAMA_UPLOAD_STORE_FILE);
  if (!existsSync(uploadStoreFile)) {
    console.error('OZAMA_UPLOAD_STORE_FILE no apunta a un keystore existente.');
    process.exit(1);
  }
}

// OneDrive can turn empty generated placeholders into unreadable reparse points.
for (const folder of ['java', 'res']) {
  const placeholder = join(androidRoot, 'capacitor-cordova-android-plugins', 'src', 'main', folder, '.gitkeep');
  if (existsSync(placeholder)) unlinkSync(placeholder);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome,
  ANDROID_SDK_ROOT: androidHome,
  OZAMA_UPLOAD_STORE_FILE: uploadStoreFile || process.env.OZAMA_UPLOAD_STORE_FILE,
  GRADLE_OPTS: `${process.env.GRADLE_OPTS || ''} -Djava.net.preferIPv4Stack=true`.trim(),
  PATH: `${join(javaHome, 'bin')};${join(androidHome, 'platform-tools')};${process.env.PATH || ''}`
};

const buildType = buildMode === 'debug' ? 'Debug' : 'Release';
const gradleTask = buildType === 'Release' ? 'bundleRelease' : 'assembleDebug';

console.log(`Java ${majorVersion}: ${javaHome}`);
console.log(`Android SDK: ${androidHome}`);
console.log(`Gradle: ${gradleTask}`);
if (signedRelease) console.log('Firma: clave de subida privada configurada');

const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `gradlew.bat --no-daemon ${gradleTask}`], {
  cwd: androidRoot,
  env,
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) process.exit(result.status ?? 1);

const artifact = buildType === 'Release'
  ? join(androidRoot, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
  : join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

if (!existsSync(artifact)) {
  console.error('Gradle termino sin generar el artefacto esperado.');
  process.exit(1);
}

if (signedRelease) {
  const verify = spawnSync(join(javaHome, 'bin', 'jarsigner.exe'), ['-verify', '-strict', artifact], {
    encoding: 'utf8',
    shell: false,
  });
  if (verify.status !== 0) {
    console.error('El AAB se genero, pero su firma no pudo verificarse.');
    console.error((verify.stderr || verify.stdout || '').trim());
    process.exit(1);
  }
}

const sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex').toUpperCase();
console.log(`Artefacto: ${artifact}`);
console.log(`SHA-256: ${sha256}`);

process.exit(0);
