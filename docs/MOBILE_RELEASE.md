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

1. JDK 21 LTS o superior. Capacitor 8 y Android Gradle Plugin 8.13 compilan las fuentes Android con nivel Java 21.
2. Android SDK 36, Build Tools 36 y Platform Tools.
3. Un dispositivo Android autorizado por USB para pruebas reales.
4. Android Studio estable es opcional para compilar por terminal, pero recomendado para inspeccion, emulador y firma.

En la computadora principal del proyecto, JDK 21 y Android SDK 36 viven bajo `.tools/`. Esa carpeta es local, esta ignorada por Git y no se publica en GitHub.

Abrir el proyecto:

```bash
npm run mobile:open
```

Compilar e instalar la version de prueba desde Windows:

```bash
npm run mobile:sync
npm run android:build:debug
npm run android:install:debug
```

El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`. La instalacion requiere Depuracion USB activa y la huella RSA de esta computadora aceptada en el telefono.

Generar el bundle de release previo a la firma:

```bash
npm run android:build:release
```

El AAB se genera en `android/app/build/outputs/bundle/release/app-release.aab`. Esta salida valida la compilacion, pero permanece sin firma hasta crear la clave privada de produccion. La clave y sus contrasenas nunca deben entrar al repositorio.

Estado verificado el 12 de agosto de 2026:

- APK debug compilado y firmado con certificado de desarrollo.
- AAB release compilado y pendiente de firma de produccion.
- Paquete `com.ozamachess.app`, minimo Android 7.0 (API 24) y objetivo API 36.
- Permisos: Internet y un permiso interno no exportado generado por AndroidX.
- Emulador pendiente porque la virtualizacion del firmware esta desactivada en la computadora principal.

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
