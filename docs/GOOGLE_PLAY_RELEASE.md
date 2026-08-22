# OZAMA CHESS - Google Play

Documento de trabajo para preparar la primera prueba cerrada. Los textos describen funciones que ya existen. La declaracion de datos debe revisarse nuevamente en Play Console antes de enviarla.

## Identidad Del Paquete

- Nombre: `OZAMA CHESS`
- ID: `com.ozamachess.app`
- Version inicial: `1.0` (`versionCode 1`)
- Categoria sugerida: Juegos, Juegos de mesa
- Idioma principal: Espanol (Republica Dominicana)
- Correo de soporte: `axccolas@gmail.com`
- Web: `https://ozama-chess.onrender.com/`
- Privacidad: `https://ozama-chess.onrender.com/privacy.html`
- Soporte: `https://ozama-chess.onrender.com/support.html`
- Eliminacion de cuenta: `https://ozama-chess.onrender.com/account-deletion.html`

## Ficha En Espanol

Nombre, maximo 30 caracteres:

```text
OZAMA CHESS
```

Descripcion corta, maximo 80 caracteres:

```text
Ajedrez online con partidas en tiempo real, ELO, salas privadas y bot.
```

Descripcion completa:

```text
OZAMA CHESS lleva el ajedrez online a una experiencia visual inspirada en la identidad dominicana.

Compite en partidas en tiempo real, encuentra rivales mediante juego rapido o crea una sala privada para jugar con amigos. Cada partida online incluye reloj, chat, movimientos legales, jaque, jaque mate, tablas, rendicion y reconexion.

Mejora tu posicion en el ranking con el sistema ELO, consulta tus estadisticas e historial competitivo y personaliza tu perfil con pais, avatar o foto. Tambien puedes agregar amigos, enviar desafios directos y practicar contra OZAMA Bot en distintos niveles.

Funciones principales:
- Partidas de ajedrez online en tiempo real.
- Juego rapido y salas privadas mediante codigo.
- OZAMA Bot para practicar sin afectar el historial competitivo.
- Ranking ELO, estadisticas e historial de partidas.
- Perfil de jugador, foto, pais y lista de amigos.
- Chat dentro de las partidas online.
- Recuperacion de contrasena y eliminacion de cuenta.

Se necesita una cuenta para entrar al lobby y jugar. Las partidas online requieren conexion a Internet.
```

## Activos De La Ficha

- Icono: PNG de `512 x 512`, maximo 1 MB. `public/icon-512.png` cumple tamano y peso.
- Imagen destacada: JPEG o PNG sin transparencia de `1024 x 500`. Pendiente crear la version final.
- Capturas: preparar al menos cuatro capturas reales de telefono en `1080 x 1920`.
- Primera captura: lobby y opciones de juego.
- Segunda captura: partida online con tablero, jugadores y reloj.
- Tercera captura: perfil, ELO e historial.
- Cuarta captura: ranking Hall of Fame.

No incluir marcos de telefonos, botones de descarga, posiciones falsas en rankings ni funciones futuras en las capturas.

## Borrador De Seguridad De Datos

Datos que la aplicacion procesa actualmente:

| Categoria | Datos | Uso principal | Obligatorio |
| --- | --- | --- | --- |
| Informacion personal | Correo electronico | Crear, autenticar, recuperar y administrar la cuenta | Si |
| Identificadores | Usuario e ID interno | Perfil, amistades, partidas, soporte y seguridad | Si |
| Fotos | Foto de perfil | Personalizacion del perfil | No |
| Actividad en la app | Movimientos, resultados, ELO e historial | Juego, ranking, estadisticas e integridad competitiva | Si al jugar online |
| Contenido generado | Pais, avatar y relaciones de amistad | Perfil y funciones sociales | Parcialmente opcional |
| Diagnostico temporal | Direccion de red para limites de acceso | Seguridad y prevencion de abuso | Automatico |

- Las contrasenas y codigos de recuperacion se conservan como hashes.
- JWT, contrasenas y codigos de recuperacion no deben aparecer en logs ni analitica.
- El trafico de produccion usa HTTPS/WSS.
- La cuenta se puede eliminar dentro de la app y desde la pagina publica de ayuda.
- El chat se transmite durante la partida y actualmente no se guarda intencionalmente como historial permanente.
- Render y MongoDB Atlas actuan como proveedores de infraestructura. Confirmar en Play Console el tratamiento aplicable como proveedores de servicio.
- Actualmente no hay anuncios, pagos ni SDK de analitica publicitaria.

Este cuadro es un borrador tecnico, no una certificacion legal. La declaracion final debe coincidir con la version exacta que se publique y con todos sus SDK.

## Clave De Subida Y AAB Firmado

Crear una clave de subida una sola vez y guardar dos copias privadas fuera del repositorio. No compartir el archivo ni sus contrasenas por chat, correo o GitHub.

La llave oficial se crea desde la terminal local con:

```powershell
.\scripts\create-android-upload-key.cmd
```

El asistente guarda la llave en `%USERPROFILE%\OZAMA-PRIVATE\ozama-upload.jks`, fuera del repositorio y de OneDrive. Para generar el bundle firmado:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-android-signed.ps1
```

La contrasena se solicita de forma oculta, permanece solo en la memoria del proceso y se elimina al terminar. El bundle resultante queda en `android/app/build/outputs/bundle/release/app-release.aab`. El comando verifica la firma y muestra el hash SHA-256 que se debe conservar junto al registro de la version subida.

Antes de publicar, conservar dos copias privadas de la llave en ubicaciones separadas. Perder la llave de subida o su contrasena impide firmar nuevas versiones hasta completar el proceso de restablecimiento de Google Play.

### Primer Candidato Firmado

- Generado: `2026-08-21 22:36 AST`
- Archivo local: `android/app/build/outputs/bundle/release/app-release.aab`
- Tamano: `13,042,907 bytes`
- SHA-256 del AAB: `4A37ACF905FDD945AA164AAFA13F3C00A426D12EB93CD1AA6D12CA22EFD3FE00`
- Alias de subida: `ozama-upload`
- Certificado: `RSA 4096 bits`, `SHA384withRSA`, valido hasta `2054-01-06`
- SHA-1 del certificado: `42:A8:15:13:D4:69:E2:A4:B7:D4:03:32:FE:98:6F:CF:03:51:7B:52`
- SHA-256 del certificado: `5C:89:8C:3E:47:44:7B:0C:65:01:73:B3:57:A8:85:0E:6B:88:C7:DC:7A:45:41:66:E8:8C:5D:B2:59:22:61:01`
- Verificacion local: `jar verified`

El hash del AAB cambia al volver a compilar. Las huellas del certificado deben permanecer iguales en todas las versiones firmadas con esta llave de subida.

## Orden De Publicacion

1. Instalacion y arranque del APK debug confirmados en un telefono Android real.
2. Completar las pruebas funcionales de cuenta, partida online, reconexion y responsive movil.
3. Crear y respaldar la clave privada de subida.
4. Compilar y verificar el AAB firmado.
5. Crear la aplicacion en Play Console con `com.ozamachess.app`.
6. Completar ficha, privacidad, eliminacion, clasificacion y seguridad de datos.
7. Subir el AAB a prueba interna y luego a prueba cerrada.
8. Invitar probadores y documentar errores antes de solicitar produccion.

## Comportamiento Nativo Android

La base movil incluye estas protecciones de experiencia:

- Areas seguras para camara, notch y barra de gestos mediante `safe-area-inset-*`.
- Barra de estado y navegacion en carbon con iconos claros.
- Teclado con `adjustResize`, altura visual dinamica y desplazamiento del campo enfocado.
- Boton Atras dentro de la partida conectado a la advertencia de salida y regreso al lobby.
- Reconexion y resincronizacion de Socket.IO al volver desde segundo plano.
- Tablero sin seleccion de texto, menu contextual, arrastre ni zoom accidental sobre las casillas.
- Icono y splash de marca con el caballo dorado.
- La sincronizacion movil materializa automaticamente los assets que OneDrive marca como archivos especiales antes de invocar Gradle.

Antes de cada AAB, probar en al menos un Android con gestos y otro con botones:

1. Abrir login y chat, mostrar el teclado y confirmar que el campo activo permanece visible.
2. Entrar a una partida online, minimizar la app durante 15 segundos y regresar.
3. Confirmar que tablero, turno y relojes coinciden en ambos telefonos.
4. Pulsar Atras durante la partida, cancelar una vez y luego confirmar la salida al lobby.
5. Mantener pulsada una pieza y hacer gesto de pellizco sobre el tablero; no debe aparecer seleccion ni cambiar el zoom.
