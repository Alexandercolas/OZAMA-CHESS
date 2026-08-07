# OZAMA CHESS - Development Roadmap

Este roadmap ordena el crecimiento de OZAMA CHESS como plataforma real, sin romper la arquitectura actual ni meter frameworks frontend.

## Prioridad 1 - Estabilidad Y Seguridad

Objetivo: que login, partidas online, perfil y datos del usuario funcionen de forma confiable antes de crecer en features.

- Mantener rutas privadas protegidas por JWT.
- Validar entradas criticas: login, registro, perfil, salas, chat y admin.
- Limitar intentos de login, registro y recuperacion de contrasena.
- Evitar exponer detalles internos en errores de API.
- Probar rejoin y refresh en partidas online y bot.
- Revisar responsive movil en lobby, game, profile y ranking.
- Mantener `.env` fuera de GitHub y documentar variables en `.env.example`.

## Prioridad 2 - Experiencia De Juego

Objetivo: que jugar se sienta claro, justo y pulido.

- Confirmar turnos y color del jugador en partidas online.
- Mantener sombra del ultimo movimiento visible para ambos jugadores.
- Mostrar movimientos legales antes de mover.
- Mejorar sonidos por accion: mover, capturar, jaque, mate, tabla, rendirse.
- Pulir chat sin afectar tamano del tablero.
- Completar historial de partidas online.
- Mantener partidas contra bot fuera del historial competitivo, salvo que luego se cree un historial separado de entrenamiento.

## Prioridad 3 - Comunidad

Objetivo: preparar la plataforma para retener usuarios.

- Amigos entre jugadores.
- Retos directos desde perfil/lobby.
- Perfil publico con partidas recientes, ELO y estadisticas.
- Eventos visibles para usuarios.
- Ranking Hall of Fame mas explicativo.
- Notificaciones basicas dentro del lobby.

## Prioridad 4 - Admin

Objetivo: administrar la plataforma sin tocar la base de datos manualmente.

- Proteger `/admin.html` por email autorizado en `ADMIN_EMAILS`.
- Panel de usuarios: buscar, activar/desactivar, marcar premium.
- Panel de eventos: crear, publicar, archivar.
- Vista de partidas recientes y actividad.
- Herramientas de soporte basicas: revisar usuario, ELO y estado de cuenta.

## Prioridad 5 - Premium

Objetivo: preparar monetizacion sin afectar el juego gratis.

- Plan `free` como experiencia completa jugable.
- Plan `premium` orientado a confort visual y extras no injustos.
- Temas premium, avatares, marcos, analisis futuro y estadisticas avanzadas.
- Integracion de pagos solo despues de estabilizar auth, admin y soporte.

## Prioridad 6 - App Movil / PWA

Objetivo: llevar OZAMA CHESS a celular de forma ordenada.

- Primero PWA instalable.
- Luego empaquetado Android/iOS si la experiencia web movil esta estable.
- Politica de privacidad, terminos, iconos, splash screen y permisos minimos.
- Preparar builds para Google Play y App Store cuando el producto este probado.

Estado actual:

- Base PWA instalable completada: manifiesto, iconos, service worker y pantalla sin conexion.
- API, JWT y Socket.IO quedan fuera del cache local.
- Politica de privacidad, terminos, soporte y eliminacion de cuenta completados.
- Base Android Capacitor completada con iconos, splash, HTTPS obligatorio y frontend empaquetado.
- Pendiente manual: validar instalacion desde produccion y configurar Google Search Console.
- Pendiente para tiendas: Android Studio/JDK moderno, firma AAB, cuenta de Play Console y pruebas cerradas.
- Pendiente iOS: macOS, Xcode, Apple Developer y revision de App Store.

## Prioridad 7 - Operacion

Objetivo: saber que pasa cuando usuarios reales entren.

- Logs utiles sin datos sensibles.
- Health checks.
- Backups de MongoDB Atlas.
- Monitoreo de errores.
- Checklist de deploy Render.
- Checklist antes de cada push a `main`.

## Orden Recomendado Ahora

1. Cerrar bugs de partidas online y refresh.
2. Revisar seguridad basica y errores visibles.
3. Probar responsive en celular real.
4. Completar historial/amigos/perfil.
5. Pulir landing/lobby/game visualmente.
6. Fortalecer admin.
7. Preparar premium.
8. Firmar, probar y publicar Android; preparar iOS desde macOS.
