# OZAMA CHESS - Mobile Release Guide

Esta guia describe el camino desde el repositorio actual hasta una publicacion real. No contiene secretos ni reemplaza las revisiones de Google, Apple o asesoria legal aplicable.

## Arquitectura Actual

- App ID Android: `com.ozamachess.app`
- Nombre: `OZAMA CHESS`
- Contenedor: Capacitor 8
- Frontend: archivos de `public/` empaquetados dentro de la app
- Backend remoto: `https://ozama-chess.onrender.com`
- Comunicacion: HTTPS para REST y WSS para Socket.IO
- Secretos: permanecen en Render; nunca se copian al APK

El ID de paquete debe tratarse como definitivo antes de publicar. Google Play no permite cambiar el ID de una aplicacion existente.

## Verificacion Comun

```bash
npm install
npm run check
npm audit --omit=dev
npm run mobile:sync
```

Cada cambio en `public/` requiere ejecutar `npm run mobile:sync` antes de compilar Android.

## Android

Requisitos locales:

1. Android Studio estable.
2. Android SDK 36 y herramientas indicadas por Gradle.
3. JDK compatible con la version de Android Gradle Plugin. Se recomienda usar el JDK incluido en Android Studio.
4. Un dispositivo Android o emulador para pruebas.

Abrir el proyecto:

```bash
npm run mobile:open
```

Pruebas minimas en dispositivo:

- Registro, login, cierre y recuperacion de contrasena.
- Eliminacion de cuenta dentro de la app.
- Lobby, matchmaking, sala por codigo y rejoin.
- Colores/turnos correctos en dos dispositivos.
- Chat, reloj, rendicion, tablas, jaque y jaque mate.
- Perfil, foto, amigos, historial y ranking.
- Rotacion, teclado, boton atras y perdida de red.
- Enlace a privacidad, terminos, soporte y eliminacion publica.

## Google Play

Antes de produccion:

1. Crear la cuenta de Google Play Console.
2. Crear la aplicacion con el ID `com.ozamachess.app`.
3. Generar una clave de firma y guardarla fuera de Git/OneDrive publico.
4. Compilar un Android App Bundle firmado (`.aab`) desde Android Studio.
5. Publicar primero en una pista de prueba interna o cerrada.
6. Completar ficha, categoria, clasificacion de contenido y publico objetivo.
7. Completar la seccion de seguridad de datos con informacion real.
8. Usar estas URL publicas:
   - Privacidad: `https://ozama-chess.onrender.com/privacy.html`
   - Soporte: `https://ozama-chess.onrender.com/support.html`
   - Eliminacion: `https://ozama-chess.onrender.com/account-deletion.html`
9. Preparar icono, banner, capturas de telefono y descripcion en espanol.

No se debe declarar que no se recopilan datos: la plataforma procesa cuentas, perfiles, amistades, ELO e historial de partidas.

## iOS

iOS no se puede compilar ni firmar desde Windows. El paso nativo requiere:

1. Una Mac con Xcode compatible.
2. Cuenta Apple Developer.
3. Instalar la plataforma iOS de Capacitor en esa Mac.
4. Generar certificados, perfiles de aprovisionamiento y firma.
5. Probar en iPhone real y distribuir primero por TestFlight.
6. Completar App Privacy, capturas, soporte, privacidad y eliminacion de cuenta.

## Operacion Antes Del Lanzamiento

- Configurar Google Search Console y enviar `sitemap.xml`.
- Configurar backups y alertas en MongoDB Atlas.
- Agregar monitoreo de errores antes de una campana grande.
- Revisar logs sin guardar contrasenas, JWT ni codigos de recuperacion.
- Considerar un servidor sin suspension automatica cuando el trafico lo justifique.
- Congelar una version candidata y ejecutar pruebas online con dos cuentas y dos redes.

## Lo Que No Se Publica

- `.env`
- `MONGODB_URI`
- `JWT_SECRET`
- contrasenas de administracion
- keystores o contrasenas de firma
- `android/local.properties`
- tokens personales de Google o Apple
