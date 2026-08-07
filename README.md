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
JWT_SECRET=
ADMIN_EMAILS=
PORT=3000
```

Notas:

- `.env` no se sube a GitHub.
- `ADMIN_EMAILS` acepta uno o varios correos separados por coma.
- En Render, estas variables deben vivir en el panel de Environment.

## Comandos

```bash
npm install
npm start
```

Desarrollo local:

```bash
npm run dev
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

## Admin

El panel admin esta protegido por JWT y por email autorizado en `ADMIN_EMAILS`.

El admin inicial permite:

- Ver estadisticas de plataforma
- Crear y publicar eventos
- Ver usuarios registrados
- Marcar usuarios como premium

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

## Limpieza Local

Estos elementos se mantienen fuera de Git:

- `.env`
- `node_modules/`
- logs `*.log`, `*.err.log`, `*.out.log`
- copias legacy locales `public/css/`, `public/js/`, `public/Untitled-1.css`

La app activa usa los archivos directos de `public/`, especialmente `public/style.css` y `public/script.js`.
