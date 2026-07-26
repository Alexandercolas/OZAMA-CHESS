# OZAMA CHESS - Security Notes

Este documento resume las reglas minimas de seguridad para operar OZAMA CHESS como plataforma.

## Secretos

- Nunca subir `.env` a GitHub.
- `JWT_SECRET` debe ser largo, privado y diferente entre desarrollo y produccion.
- `MONGODB_URI` debe vivir solo en variables de entorno locales o en Render.
- `ADMIN_EMAILS` define quienes pueden entrar a `/admin.html`.

## Autenticacion

- Las rutas privadas usan JWT.
- Las contrasenas se guardan con bcrypt.
- Login, registro y recuperacion tienen rate limit.
- Los mensajes de error de login/reset no deben revelar si el usuario existe.

## Datos De Usuario

- El backend valida username, email, pais, avatar y contrasenas.
- Las fotos de perfil aceptan solo `png`, `jpeg` o `webp` en data URL y con limite de tamano.
- El frontend puede mejorar UX, pero la validacion importante debe vivir en backend.

## Admin

- El panel admin requiere JWT y email autorizado.
- Las operaciones admin validan IDs de MongoDB antes de consultar.
- Eventos admin validan tipo, estado, fechas y limite de jugadores.
- Premium no debe dar ventajas deportivas.

## Frontend

- Evitar insertar texto de usuarios con `innerHTML`.
- Preferir `textContent` para nombres, chats, eventos y mensajes.
- Si se usa `innerHTML`, escapar siempre los valores dinamicos.

## Deploy

- Render debe tener `MONGODB_URI`, `JWT_SECRET`, `ADMIN_EMAILS` y `NODE_ENV=production`.
- Revisar logs despues de cada deploy.
- Probar login, lobby, partida online, rejoin, perfil y admin despues de cada push importante.

## Siguiente Nivel

- CSRF no es critico mientras el token viva en `Authorization: Bearer`, pero se debe revisar si se cambia a cookies.
- Agregar monitoreo de errores antes de lanzar pagos.
- Agregar backups/recovery de MongoDB Atlas.
- Hacer pruebas E2E para login, partida online y recuperacion de contrasena.
