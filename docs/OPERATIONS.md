# Operacion y despliegue

Esta guia cubre la instancia unica de Node.js/Socket.IO que usa OZAMA CHESS hoy. Un push a `main` puede iniciar un deploy de Render; no asumas que el deploy termino solo porque GitHub acepto el push.

## Antes del deploy

1. Anota el commit actual y revisa los cambios que entraran. No subas `.env`, tokens, claves de firma ni cambios locales ajenos.
2. Ejecuta `npm run check`, `npm run test:restart:chess` y `npm run test:restart:damas`. Las pruebas de reinicio usan una base temporal aislada; nunca apuntes scripts de prueba a la base de produccion.
3. Comprueba en Atlas que el respaldo del cluster esta habilitado para el plan contratado, su ultima fecha util y el procedimiento de restauracion disponible. Un respaldo no se considera probado hasta restaurarlo en un entorno aislado.
4. Si hay partidas activas, anuncia o coordina el despliegue. El tablero y el reloj se guardan en Mongo, pero los sockets se cortan durante el reinicio y los jugadores necesitan reconectar. No prometas una transicion invisible.

## Despues del deploy

1. Confirma en Render que el deploy termino correctamente y anota el commit desplegado.
2. Consulta `/api/health/db`: exige `database: "connected"` en el JSON. Esta ruta puede responder HTTP 200 incluso si la base esta desconectada; no uses solo el codigo HTTP como senal de salud.
3. Consulta `/api/app-version` y comprueba que la version corresponde al deploy esperado.
4. Revisa los logs del arranque y busca `[GAME_STORAGE_FAILURE]`. Una linea como `game=damas operation=restore_room error=MongoServerSelectionError` indica un fallo real de almacenamiento, no un intento de reconexion con token invalido. Estas lineas no contienen JWT, tokens de sala ni datos de usuarios.
5. Confirma una reconexion real de ajedrez y Damas en un entorno controlado. Si ocurre un error en produccion, evita crear cuentas o partidas de prueba alli.

## Incidente de partida o reconexion

1. Anota hora, commit desplegado, juego afectado y operacion de `[GAME_STORAGE_FAILURE]`. No copies JWT, tokens, contrasenas ni cadenas de conexion a tickets o chats.
2. Comprueba el estado de Mongo/Atlas y la respuesta JSON de `/api/health/db`. `rejoin-failed` por si solo no demuestra un fallo de base: tambien ocurre si la sala termino o el token no es valido.
3. Si falla `save_room`, `save_clock`, `restore_room` o `save_result`, pausa nuevos despliegues y revisa los logs de Render y Atlas. No borres salas ni resultados manualmente para "destrabar" el sistema.
4. Si el incidente empezo con el ultimo deploy y la base esta sana, vuelve a una revision conocida del codigo siguiendo el procedimiento del proveedor. Un rollback de codigo no revierte cambios en Mongo.
5. Para recuperar datos, restaura primero una copia en una base **aislada** y verifica cuentas, historial y salas. Restaurar directamente sobre produccion puede sobrescribir partidas y registros posteriores; requiere una decision explicita del propietario.

## Limites actuales

- Los relojes se guardan periodicamente y durante un apagado ordenado. Un corte brusco puede perder los segundos transcurridos desde el ultimo guardado.
- La recuperacion de salas esta preparada para un proceso de servidor. Escalar a varias instancias requiere coordinar eventos de Socket.IO y el acceso concurrente a las salas; no basta con agregar instancias en Render.
- El prefijo `[GAME_STORAGE_FAILURE]` facilita buscar fallos, pero **no envia alertas**. Configura y verifica una alerta en el servicio de logs/monitorizacion antes de depender de ella.
- La configuracion de backups y su restauracion en Atlas es una tarea operativa manual; este repositorio no puede confirmar el estado real del cluster de produccion.
