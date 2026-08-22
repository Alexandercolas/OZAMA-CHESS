# OZAMA CHESS

OZAMA CHESS es una plataforma de ajedrez online con identidad visual Brutal Colonial: partidas en tiempo real, salas privadas, bot local, ranking ELO, perfiles, historial y panel admin inicial.

## Stack

- Node.js + Express
- Socket.IO
- MongoDB Atlas + Mongoose
- HTML/CSS/JS vanilla
- Deploy en Render desde `main`

## Estructura

```text
config/              Conexion a MongoDB
middleware/          Autenticacion JWT y permisos admin
models/              User, Match, Room, Event
routes/              Auth, user, admin, events
public/              Frontend vanilla servido por Express
public/assets/       SVGs y sonidos del juego
android/             Proyecto nativo Android generado con Capacitor
tests/               Pruebas de seguridad y preparacion de lanzamiento
scripts/             Verificacion estatica del proyecto
server.js            Servidor Express + Socket.IO + motor multiplayer
```

Mapa detallado para trabajar en VS Code:

```text
docs/PROJECT_STRUCTURE.md
```

Roadmap recomendado de desarrollo:

```text
docs/ROADMAP.md
```

Notas de seguridad:

```text
SECURITY.md
```

## Variables De Entorno

Crea `.env` local usando `.env.example` como base:

```text
MONGODB_URI=
MONGODB_DB_NAME=ozama-chess
JWT_SECRET=
ADMIN_EMAILS=
APP_ORIGINS=https://ozama-chess.onrender.com
PORT=3000
```

Notas:

- `.env` no se sube a GitHub.
- `MONGODB_DB_NAME` debe ser `ozama-chess` en produccion. Los scripts de prueba deben usar siempre una base temporal con prefijo `ozama_dynamic_`, `ozama_test_`, `ozama_security_` u `ozama_tmp_`.
- `ADMIN_EMAILS` acepta uno o varios correos separados por coma.
- `APP_ORIGINS` permite agregar origenes nativos o dominios propios, separados por coma.
- En Render, estas variables deben vivir en el panel de Environment.

## Regla De Pruebas Dinamicas

Toda prueba dinamica o de seguridad que escriba en MongoDB debe correr contra una base aislada y temporal, nunca contra `ozama-chess`. Los scripts de prueba deben usar `scripts/test-db-guard.js`; ese guard aborta antes de arrancar si detecta `MONGODB_DB_NAME=ozama-chess` o cualquier nombre que no parezca temporal.

## Ranking Publico

`/leaderboard.html` es una vitrina publica y finita: el backend devuelve solo el Top 20. La API publica no expone email, ultimo acceso, amigos ni IDs internos en la seleccion de campos. Las cuentas de prueba conocidas o generadas por scripts (`sec[A-D]_########`) quedan excluidas del ranking aunque existan temporalmente en la base.

## Comandos

```bash
npm install
npm start
```

Desarrollo local:

```bash
npm run dev
```

Verificacion completa antes de publicar:

```bash
npm run check
```

URL local principal:

```text
http://localhost:3000/
```

## Rutas Frontend

- `/` landing
- `/login.html` login, registro y recuperacion de contrasena
- `/lobby.html` lobby multiplayer y bot
- `/game.html` tablero
- `/profile.html` perfil, avatar, amigos e historial
- `/leaderboard.html` ranking
- `/admin.html` panel admin privado
- `/privacy.html` politica de privacidad
- `/terms.html` terminos de uso
- `/support.html` soporte al jugador
- `/account-deletion.html` solicitud publica de eliminacion

## Admin

El panel admin esta protegido por JWT y por email autorizado en `ADMIN_EMAILS`.

El panel administrativo usa la misma cuenta de jugador, sin un segundo login. El acceso solo aparece cuando `/api/admin/verify` confirma que el correo activo esta incluido en `ADMIN_EMAILS`.

Permite:

- Ver usuarios registrados, jugadores Socket.IO, salas vivas y partidas guardadas
- Buscar usuarios, suspender/reactivar cuentas y gestionar Premium
- Revocar todas las sesiones de un usuario mediante `tokenVersion`
- Inspeccionar salas en memoria y ejecutar un cierre de emergencia auditado
- Revisar partidas finalizadas y su PGN
- Crear torneos, eventos, anuncios y mantenimientos
- Controlar estados de evento: borrador, activo, finalizado o cancelado
- Revisar salud basica del servidor y acciones administrativas recientes

La carcasa de `/admin.html` no contiene datos sensibles. Todas las lecturas y operaciones viven bajo `/api/admin/*`, requieren JWT vigente, cuenta activa, correo autorizado y limites de solicitudes.

En la web, la sesion se entrega mediante una cookie `HttpOnly` segura. Los JWT web
anteriores se migran automaticamente y se eliminan de `localStorage`. La APK conserva
el bearer durante esta etapa para mantener compatibilidad con Capacitor y Socket.IO.

## Deploy

Render debe ejecutar:

```bash
npm start
```

Si Render esta conectado a GitHub, cada push a `main` dispara un nuevo deploy automaticamente.

## Google Search

La portada y el ranking son las paginas publicas indexables. Login, lobby, partida, perfil y admin usan `noindex` para evitar que informacion operativa aparezca en resultados.

Archivos preparados:

```text
public/robots.txt
public/sitemap.xml
public/index.html (canonical, Open Graph y datos estructurados)
```

Paso manual del propietario:

1. Agregar `https://ozama-chess.onrender.com/` a Google Search Console.
2. Verificar la propiedad.
3. Enviar `https://ozama-chess.onrender.com/sitemap.xml`.
4. Inspeccionar la portada y solicitar indexacion.

## PWA

OZAMA CHESS incluye una base instalable para navegador y celular:

```text
public/manifest.webmanifest
public/service-worker.js
public/pwa.js
public/offline.html
public/icon-192.png
public/icon-512.png
```

El service worker no almacena respuestas de `/api/`, Socket.IO ni solicitudes autenticadas. Las partidas online siguen usando al servidor como fuente de verdad.

## Android

La base Android esta en `android/` y usa Capacitor. El frontend viaja dentro de la aplicacion; solo las solicitudes de API y Socket.IO se conectan por HTTPS a Render. MongoDB, JWT y las variables de entorno nunca se incluyen en el APK.

```bash
npm run mobile:sync
npm run android:build:debug
npm run android:install:debug
```

El APK de prueba se genera en `android/app/build/outputs/apk/debug/app-debug.apk`. El instalador requiere un telefono Android conectado y autorizado por USB. `npm run mobile:open` queda disponible cuando Android Studio este instalado.

El identificador inicial es `com.ozamachess.app`. Debe considerarse definitivo antes de publicar en Google Play. La guia completa de firma, AAB, Play Console e iOS esta en `docs/MOBILE_RELEASE.md`.

## Limpieza Local

Estos elementos se mantienen fuera de Git:

- `.env`
- `node_modules/`
- `.tools/` (JDK y Android SDK locales)
- logs `*.log`, `*.err.log`, `*.out.log`
- copias legacy locales `public/css/`, `public/Untitled-1.css` y cualquier archivo de
  `public/js/` distinto de los modulos administrativos versionados

La app activa usa los archivos directos de `public/`, especialmente `public/style.css` y `public/script.js`.
