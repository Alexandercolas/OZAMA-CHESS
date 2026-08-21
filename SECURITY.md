# OZAMA CHESS - Security Notes

Este documento resume las reglas minimas de seguridad para operar OZAMA CHESS como plataforma.

## Secretos

- Nunca subir `.env` a GitHub.
- `JWT_SECRET` debe ser largo, privado y diferente entre desarrollo y produccion.
- En produccion, el servidor no debe arrancar si `JWT_SECRET` falta o tiene menos de 32 caracteres.
- `MONGODB_URI` debe vivir solo en variables de entorno locales o en Render.
- `ADMIN_EMAILS` define quienes pueden entrar a `/admin.html`.
- `APP_ORIGINS` limita los origenes web/nativos autorizados para API y Socket.IO.

## Autenticacion

- Las rutas privadas usan JWT.
- Los JWT aceptan unicamente `HS256` y se validan contra un usuario activo.
- Cambiar o recuperar la contrasena revoca los JWT emitidos anteriormente.
- Las contrasenas se guardan con bcrypt.
- Las nuevas contrasenas requieren al menos 8 caracteres.
- Login, registro y recuperacion tienen rate limit.
- Cada codigo de recuperacion se invalida despues de usarlo y se reemplaza por uno nuevo.
- Los mensajes de error de login/reset no deben revelar si el usuario existe.

## Datos De Usuario

- El backend valida username, email, pais, avatar y contrasenas.
- Las fotos de perfil aceptan solo `png`, `jpeg` o `webp` en data URL y con limite de tamano.
- El frontend puede mejorar UX, pero la validacion importante debe vivir en backend.
- El usuario puede eliminar su cuenta desde el perfil confirmando contrasena y la palabra `ELIMINAR`.
- Al eliminar una cuenta, los datos personales se borran o desvinculan; los resultados competitivos pueden permanecer anonimizados.

## Admin

- El panel admin usa la cuenta normal del propietario; no existe un segundo login administrativo.
- El permiso depende exclusivamente de `ADMIN_EMAILS`; el campo `isAdmin` de MongoDB no concede acceso por si solo.
- Cada solicitud valida JWT, `tokenVersion`, cuenta activa y correo autorizado en el servidor.
- `/api/admin/*` aplica limites por IP y por administrador autenticado.
- Las operaciones admin validan IDs de MongoDB antes de consultar.
- Las listas usan proyecciones positivas y nunca retornan password, recoveryCodeHash, tokenVersion o secretos de sala.
- Suspender una cuenta o cerrar sus sesiones incrementa `tokenVersion` y desconecta sus sockets.
- El administrador no puede suspenderse ni revocar su propia sesion desde el panel.
- Los cierres de emergencia terminan la partida como abandonada y no adjudican ELO.
- Eventos admin validan tipo, estado, fechas y limite de jugadores.
- Las acciones administrativas se auditan en MongoDB y expiran automaticamente despues de 90 dias.
- Premium no debe dar ventajas deportivas.

## Frontend

- Evitar insertar texto de usuarios con `innerHTML`.
- Preferir `textContent` para nombres, chats, eventos y mensajes.
- Si se usa `innerHTML`, escapar siempre los valores dinamicos.
- Las cabeceras HTTP bloquean iframes, MIME sniffing y fuentes de contenido no autorizadas.

## Partidas Online

- Socket.IO exige un JWT valido antes de aceptar la conexion.
- El servidor decide color, turno, movimientos legales, reloj, resultado y ELO.
- Chat, tablas, rendicion, revancha y desafios verifican que el socket corresponde al jugador.
- Los paquetes demasiado grandes o el trafico excesivo por conexion se rechazan.

## Deploy

- Render debe tener `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAILS` y `NODE_ENV=production`.
- Al cambiar `JWT_SECRET`, todos los usuarios tendran que iniciar sesion de nuevo.
- Revisar logs despues de cada deploy.
- Probar login, lobby, partida online, rejoin, perfil y admin despues de cada push importante.
- Ejecutar `npm run check` y `npm audit --omit=dev` antes de cada lanzamiento importante.

## Aplicacion Movil

- El frontend se empaqueta en la app; no se usa una URL remota como pantalla completa.
- Solo `/api/` y Socket.IO apuntan al dominio HTTPS de produccion.
- Android bloquea trafico HTTP y copias de seguridad de datos de la aplicacion.
- Ningun secreto de Render, MongoDB o firma debe vivir en `public/`, `capacitor.config.json` o el APK.
- Keystores, contrasenas de firma y `local.properties` nunca se suben a GitHub.

## Siguiente Nivel

- CSRF no es critico mientras el token viva en `Authorization: Bearer`, pero se debe revisar si se cambia a cookies.
- Agregar monitoreo de errores antes de lanzar pagos.
- Agregar backups/recovery de MongoDB Atlas.
- Hacer pruebas E2E para login, partida online y recuperacion de contrasena.
