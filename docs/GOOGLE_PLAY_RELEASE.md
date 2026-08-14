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

Variables requeridas durante la compilacion firmada:

```text
OZAMA_UPLOAD_STORE_FILE
OZAMA_UPLOAD_STORE_PASSWORD
OZAMA_UPLOAD_KEY_ALIAS
OZAMA_UPLOAD_KEY_PASSWORD
```

Ejemplo de una sesion local de PowerShell, sustituyendo los valores de forma privada:

```powershell
$env:OZAMA_UPLOAD_STORE_FILE = 'C:\ruta-privada\ozama-upload.jks'
$env:OZAMA_UPLOAD_STORE_PASSWORD = 'CONTRASENA_PRIVADA'
$env:OZAMA_UPLOAD_KEY_ALIAS = 'ozama-upload'
$env:OZAMA_UPLOAD_KEY_PASSWORD = 'CONTRASENA_PRIVADA'
npm run android:build:signed
```

El bundle resultante queda en `android/app/build/outputs/bundle/release/app-release.aab`. El comando verifica la firma y muestra el hash SHA-256 que se debe conservar junto al registro de la version subida.

## Orden De Publicacion

1. Probar el APK debug en uno o mas telefonos reales.
2. Crear y respaldar la clave privada de subida.
3. Compilar y verificar el AAB firmado.
4. Crear la aplicacion en Play Console con `com.ozamachess.app`.
5. Completar ficha, privacidad, eliminacion, clasificacion y seguridad de datos.
6. Subir el AAB a prueba interna y luego a prueba cerrada.
7. Invitar probadores y documentar errores antes de solicitar produccion.
