# OZAMA PRO — Auditoría general (Fase 0)

Fecha: 2026-09-12. Alcance: todo lo pedido en el documento "OZAMA CHESS & DAMAS — FASE FINAL — OZAMA PRO", auditado contra el estado real del código antes de programar nada. Formato por área: **IMPLEMENTADO** / **PARCIAL** / **FALTANTE** / **BUG** / **MEJORA**, con archivo:línea como evidencia.

---

## 1. Temporadas (Fase 1)

**PARCIAL — es solo fecha calculada, no un sistema.**

- `services/seasons.js`: `currentSeason()` calcula número/nombre/fechas por matemática de fecha (epoch 2026-01-01, `SEASON_LENGTH_DAYS=90` — **ya es una configuración central**, no está disperso). Nunca se guarda en DB, nunca se "cierra".
- `seasonProgressFor(userId)` (líneas 42-72) ya cuenta victorias/partidas de Ajedrez y Damas por separado desde el inicio de la temporada actual — **el ELO permanente nunca se toca** (comentario explícito del propio archivo: "Sin reglas de reset de ELO todavía definidas").
- **FALTANTE por completo**: modelo `Season` en DB, cierre automático, cálculo de clasificación final, entrega de recompensas, archivo/historial consultable, creación de la siguiente temporada, protección de duplicado/idempotencia. Hoy no existe ningún job ni endpoint que "cierre" nada — el número de temporada simplemente avanza solo porque se recalcula por fecha en cada request.
- **MEJORA de arquitectura ya disponible para reusar**: el patrón "upsert idempotente en cada request, sin cron real" que ya usa `services/recurringTournaments.js` (`ensureCurrentEditions`, con throttle de 5 min en `routes/events.js:18-24`) es el mecanismo de "tarea programada" que pide la Fase 34 — no hace falta `node-cron` nuevo, hay que extender ese mismo patrón para el cierre de temporada.

## 2. Blitz / ritmos de tiempo (Fase 2)

**FALTANTE (funcional) aunque la metadata ya existe.**

- `models/Event.js:56-59`: campo `timeControl` (texto libre tipo "3+0") ya existe en el schema y se muestra en las cards de torneo — pero el propio comentario dice "nunca se valida... es solo informativo".
- **BUG real confirmado**: `server.js:380` — `DEFAULT_TIME_MS = 10 * 60 * 1000` es la ÚNICA duración de reloj que existe, usada en las ~15 salas de Ajedrez que se crean en todo `server.js` (partida rápida, torneo, revancha, reconexión — todas). El torneo recurrente "Blitz Diario" (`services/recurringTournaments.js:22-32`, `timeControl:'3+0'`) en la práctica **corre con reloj de 10 minutos**, no de 3. La etiqueta "3+0"/"10+0" no afecta nada del juego real.
- **Damas no tiene reloj en absoluto**: confirmado por grep — cero ocurrencias de `clockW`/`clockB`/`clockInterval` en los 3 sitios donde se crea una `damasRooms.set(...)` (`server.js:2290, 2449, 2734`). Las partidas de Damas (incluidos los torneos "Damas del Día"/"Copa OZAMA de Damas") son 100% sin límite de tiempo hoy.
- Lo que SÍ existe y es reusable: el reloj de Ajedrez ya es 100% autoridad del servidor (`startClock`, `server.js:386-408`, `setInterval` real que decrementa y decide `time-out` en el servidor, nunca confía en el cliente) — el patrón está probado, solo hace falta parametrizarlo (por partida/torneo) en vez de la constante fija, y construir el equivalente para Damas desde cero.
- Incremento ("+1" en "2+1"): no hay ninguna lógica de incremento por jugada en ningún lado.

## 3. Torneos (Fase 3)

**PARCIAL, con un hallazgo importante: los torneos recurrentes no arrancan solos.**

- Formatos: `models/Event.js:51-55` declara `enum:['elimination','arena','swiss','round_robin']` y `routes/admin.js` lo valida al crear — pero `services/tournament.js` (53 líneas totales) **solo implementa eliminación directa** (`shuffle`/`pairUp`/`generateFirstRound`/`generateNextRound`, comentario propio línea 3). Swiss/Arena/Round Robin son valores de schema aceptados sin ninguna lógica de negocio detrás — hoy son cosméticos. Consistente con esto, el propio lobby describe el ítem como "Eliminación directa" (`public/lobby.html:1139`).
- Creación: solo admin vía `public/admin.html` (modal, no expone el campo `format` en el formulario — ni siquiera se puede elegir hoy desde la UI).
- Cuenta regresiva "empieza en": **SÍ implementada y funcionando** en `public/tournaments.html` (`countdownText()`/`startCountdownTicker()`, líneas 187-252) — actualiza en vivo cada segundo.
- **BUG/gap más importante de toda la auditoría de torneos**: no existe NINGÚN mecanismo de auto-inicio. `routes/admin.js:484-506` (`POST /events/:id/bracket/generate`) es la ÚNICA forma de pasar un torneo de `published` a `active` con bracket generado, y es 100% manual (un admin humano tiene que entrar y hacer clic). Los torneos recurrentes (`services/recurringTournaments.js` — Blitz Diario, Copa OZAMA, Damas del Día, Copa OZAMA de Damas) SÍ se auto-crean como documento (`ensureCurrentEditions`), pero se quedan en `status:'published'` para siempre a menos que un admin genere el bracket a mano cada día/semana. En la práctica, tal como está el código hoy, estos 4 torneos "automáticos" nunca arrancan solos.
- No hay cierre automático de inscripción ni emparejamiento/rondas automáticas más allá de la ronda 1 (avanzar de ronda al terminar un partido SÍ es automático, vía `handleTournamentMatchFinished` en `server.js`).

## 4. Espectador (Fase 4)

**FALTANTE — lo que existe es otra cosa.**

`public/watch.html` es un visor **estático** de una partida ya **finalizada**, compartida por link (`/api/matches/:id/public`): jugadores, resultado, PGN descargable. Cero tablero interactivo, cero reloj, cero jugadas en vivo, cero socket. No existe ningún rol de "observador" en los schemas de sala (`joinRoom` solo acepta los 2 jugadores). No aplica a Ajedrez ni a Damas. Esto es una construcción nueva completa, no una mejora.

## 5. Perfil competitivo (Fase 5)

**IMPLEMENTADO, con huecos puntuales.**

- Separación Ajedrez/Damas: ✅ completa (`profile.html`, toggle `switchGame`, ELO/stats/rango independientes por juego).
- Rachas (actual/mejor): ✅ ya en el modelo (`stats.streak`/`stats.bestStreak`, igual en `damasStats`) y se muestran.
- Historial con filtros: ✅ existe, pero vive en página separada `history.html` (filtros por juego + búsqueda), no dentro de `profile.html` mismo.
- **FALTANTE**: cero mención de "temporada" dentro de `profile.html` (ni posición, ni mejor posición, ni temporadas completadas) — la Fase 5 lo pide explícitamente y hoy no está, aunque `seasons.js` ya tiene los datos crudos para calcularlo (`seasonProgressFor`).

## 6. Personalización (Fase 6)

**IMPLEMENTADO** (confirmado por el agente de seguridad vía `routes/user.js`): temas de tablero, sets de piezas (Ajedrez y Damas por separado, `DAMAS_PIECE_SETS`), temas de plataforma, marcos — todos con gating `free:false` re-validado server-side. No se auditó a fondo la calidad visual/UX de cada tema individual (fuera de alcance de una auditoría de backend); recomendación: revisión visual puntual, no reconstrucción.

## 7. Recompensas (Fase 7)

**PARCIAL.** El otorgamiento de XP/logros/marcos desde partidas, puzzles y torneos SÍ está conectado a un único catálogo (`services/achievements.js`, `services/cosmetics.js`, `services/titles.js` — sin duplicación). El hueco es específicamente el que crea la Fase 1: no hay recompensas de **temporada** porque no hay cierre de temporada.

## 8. Misiones (Fase 8)

**PARCIAL.** `services/weeklyChallenges.js` define 3 retos semanales fijos (`gana_3`, `juega_5`, `gana_damas`), calculados sobre partidas reales (no hardcodean contadores falsos), expuestos en `GET /api/user/weekly-challenges`. **Huecos concretos**: (a) no otorgan XP/logro real al completarse — solo devuelven `completed:true/false` sin gancho a `achievements.js`; (b) no hay misiones de Blitz ni de torneos ni de temporada (los ejemplos del propio roadmap — "juega 5 Blitz", "participa en un torneo" — no existen todavía); (c) agregar una requiere tocar código (push a un array), no hay configuración/admin UI.

## 9. Logros (Fase 9)

**IMPLEMENTADO**, 16 logros catalogados (`services/achievements.js`) cubriendo genéricos cross-game, específicos de Ajedrez (2), específicos de Damas (1: Primera Coronación), y de torneos (3, otorgados directo desde `server.js`, no por el flujo genérico). **FALTANTE**: cero logros de "temporada" o "Blitz" — consistente con que ninguno de los dos sistemas existe todavía de verdad.

## 10. Motor de Damas — captura obligatoria pero libre elección (Fase 10)

**BUG ENCONTRADO Y CORREGIDO EN ESTA MISMA SESIÓN, antes de esta auditoría formal** (commit `b30d78a`): existía un caso real donde dos secuencias de captura legal distintas (piezas capturadas distintas) terminaban en la misma casilla final, y el cliente elegía la primera en silencio (`Array.find`). El servidor ya validaba correctamente cualquier secuencia legal enviada — el hueco era 100% de UI. Ya está resuelto: overlay de elección + `tests/damas-captures.test.js` con los 8 casos de QA que pide la Fase 29, verificado también en modo online. **No requiere más trabajo**, salvo que el QA de la Fase 28/29 encuentre algo nuevo.

## 11. Microinteracciones y botones (Fase 11)

**IMPLEMENTADO (base sólida) — no verificado exhaustivamente.**

`public/theme.css` ya tiene: `:focus-visible` global con outline dorado (`!important` a propósito para ganarle a `outline:none` locales, líneas 87-90 — accesibilidad real, no cosmética), estados `:hover` en `.btn-primary`/`.btn-danger`, `:disabled` (opacity 0.4 + cursor), y **`.is-loading`** con spinner (`::after` animado) ya implementado para botones primarios y de peligro. Es decir, la Fase 11 pide "crear" algo que en gran parte **ya existe** — lo que falta auditar es cobertura: ¿todos los botones nuevos (Damas revancha/tablas de esta sesión, torneos, etc.) usan estas mismas clases, o alguno quedó con estilos ad-hoc? No se verificó botón por botón.

## 12. Lobby (Fase 12)

**IMPLEMENTADO — ya cumple lo pedido, no tocar.** `lobby.html`: grid `repeat(2,1fr)` que sube a `repeat(3,1fr)` recién en `min-width:900px` (no son cards de escritorio escaladas), con 8 breakpoints reales cubriendo mobile chico, mobile grande, tablet y desktop. Confirma lo que el propio roadmap asume ("ya fue reducido y mejorado") — instrucción expresa de no reconstruir.

## 13. Navegación (Fase 13)

**PARCIAL.** El sidebar de `lobby.html` cubre Jugar/Damas/Bot/Salas/Desafíos/Torneos/Entrenamiento/Aperturas + Perfil/Historial/Colección/Ranking/Ajustes. **Faltan dos entradas de menú**: no hay "Logros" como página/ítem propio (vive embebido en perfil/dashboard) ni "Temporadas" en ningún menú — consistente con que el sistema de temporadas todavía no tiene nada que mostrar más allá del badge de `leaderboard.html`.

## 14. Experiencia de partida — estados de conexión (Fase 14)

**PARCIAL — hueco real encontrado.** Confirmado para ambos juegos: cuando el propio jugador (no el rival) pierde brevemente su conexión, el socket se reconecta solo en segundo plano (`socket.on('connect', rejoin)` en `script.js:1915`, `socket.on('connect', announceDamasPlayerOnline)` en `damas.html:1673`) **sin ningún indicador visual de "RECONECTANDO..."** — el usuario ve el tablero congelado sin feedback hasta que la reconexión termina. La desconexión del RIVAL sí está cubierta en ambos juegos (mensaje en Ajedrez, overlay con cuenta regresiva en Damas, construido esta sesión). "CONECTANDO" inicial tampoco tiene un estado visual dedicado en ninguno de los dos juegos.

## 15-16. Game over / Revancha (Fases 15-16)

**IMPLEMENTADO en ambos juegos**, con paridad ya lograda esta sesión para Damas (revancha/tablas/confirmar-rendirse, commit `770f172`) calcada del patrón ya probado de Ajedrez (`#rematch-btn`/`#draw-offer-btn` en `script.js`). No reutiliza salas innecesariamente — reusa el mismo código de sala existente en ambos casos.

## 17. Sonido (Fase 17)

**IMPLEMENTADO.** Mute compartido correctamente entre ambos juegos (misma clave `localStorage['ozama-sound-muted']`). Ajedrez: movimiento/captura/enroque/jaque/fin-de-partida (victoria y derrota comparten un solo sonido). Damas: movimiento/captura/victoria/derrota/**coronación** (más granular que Ajedrez — Damas sí distingue tonalmente victoria de derrota, construido esta sesión). **MEJORA menor posible**: Ajedrez podría distinguir sonido de victoria vs derrota como ya hace Damas, si se quiere paridad total.

## 18. Análisis (Fase 18)

**IMPLEMENTADO, con un hueco de contenido.** Existe para ambos juegos (Premium-gated), reusa el mismo motor de evaluación que ya corre en el bot (no hay motor paralelo), clasifica jugadas como "Error grave"/"Imprecisión" en español simple (nunca expone el número de evaluación cruda al usuario). **Falta específicamente "mejor jugada"**: el análisis dice QUE una jugada fue mala pero no CUÁL hubiera sido mejor — la Fase 18 lo pide explícitamente ("mejor jugada; errores; oportunidades") y hoy solo cubre "errores".

## 19-20. Entrenamiento y Puzzles (Fases 19-20)

**IMPLEMENTADO (base), PARCIAL en profundidad.** Puzzles: catálogo fijo (8 Ajedrez + 6 Damas), puzzle del día determinístico por fecha, validación server-side estricta, conectado a XP y logros. "Entrenamiento" hoy ES la misma UI de puzzles (no hay una sección de entrenamiento distinta con categorías navegables pese a que los datos ya tienen `category`: captura/captura-múltiple/coronación en Damas, mate1/fork/pin en Ajedrez — el campo existe pero no se explota en la interfaz). El tablero de `training.html` es una reimplementación mínima que compara `from/to`, no valida legalidad real en vivo (las posiciones se verificaron offline contra el motor real al crearlas, vía `scripts/_puzzle-lab.js`). **Falta**: filtro por categoría en la UI, "finales" como categoría propia de Damas, y no conectado a las misiones semanales (jugar/resolver puzzles no cuenta para ninguna misión hoy).

## 21. Ranking (Fase 21)

**IMPLEMENTADO** — separación Ajedrez/Damas construida esta sesión (`?game=chess|damas` en `/api/user/leaderboard`, commit `6138803`). **FALTANTE**: no existe ranking por Blitz (no puede existir todavía, porque Blitz como ritmo real tampoco existe — depende de la Fase 2).

## 22. Anti-trampas / seguridad (Fase 22)

**IMPLEMENTADO, sólido.** Rate limiting real (`rate-limiter-flexible`) en creación/unión de sala, envío de desafíos y jugadas — para Ajedrez y Damas por separado. Validación de payloads con Zod en prácticamente todos los handlers de socket. Autorización de sala explícita (`isAuthorizedRoomSocket` / `isAuthorizedDamasSocket`) antes de aceptar cualquier acción sensible. El ELO/resultado se calcula siempre del estado de sala que mantiene el servidor, nunca de lo que reporte el cliente. 16 tests automatizados en `tests/readiness.test.js` cubren buena parte de esto ya. **No verificado**: rate limiting HTTP (Express) en rutas REST como login/register — puede vivir en `middleware/` sin revisar todavía.

## 23. Premium/PRO (Fase 23)

**IMPLEMENTADO.** `isPremiumActive()` server-side (nunca confía en un flag del cliente), endpoint claro `GET /api/user/plan` con lista de beneficios, integración PayPal que siempre reconsulta el estado real de la suscripción (nunca confía en el `subscriptionID` que manda el cliente) y valida firma de webhook. Comentario explícito en el código: "el plan pagado nunca debe dar ventaja competitiva" — coherente con lo auditado (ningún beneficio Premium toca ELO/matchmaking). **PARCIAL**: no hay reconciliación periódica que resincronice el estado si un webhook de PayPal se pierde — depende 100% de que llegue.

## 24-26. Responsive, Accesibilidad, Performance (Fases 24-26)

**PARCIAL, disparejo entre páginas.** `game.html` tiene la cobertura responsive más completa (5 breakpoints). `damas.html` es más débil (1 solo breakpoint explícito + `prefers-reduced-motion`, aunque esto último ya lo sumé esta sesión para la animación de coronación). `profile.html` tiene un solo breakpoint. Accesibilidad: base real ya existe (`:focus-visible` global). Performance: no se encontraron fugas de timers en `server.js` (todo `setInterval`/`setTimeout` de sala tiene su `clearInterval`/`clearTimeout` correspondiente antes de reasignar) — no verificado el camino de desconexión abrupta de ambos jugadores a la vez.

## 27. Base de datos (Fase 27)

**MEJORA identificada, no bug.** `User` no tiene índice en `elo` ni `damasElo` pese a que el leaderboard ordena por esos campos — hoy es un collection scan + sort en memoria que crece con la base de usuarios. `DamasMatch` no tiene índice en `result` (a diferencia de `Match`, que sí). Las consultas de "climbers" (`/leaderboard/climbers`) filtran por `endedAt`, campo sin índice en ninguno de los dos modelos de partida. Ninguno de estos es una migración destructiva — son índices a **agregar**, no a cambiar.

---

## Resumen ejecutivo — qué es realmente nuevo vs qué es "conectar lo que ya existe"

**Construcción nueva de verdad** (no hay nada parecido hoy):
1. Modelo de Temporada en DB + cierre/recompensas/archivo automático (Fase 1)
2. Reloj real para Damas, desde cero (parte de Fase 2)
3. Auto-inicio de torneos (cierre de inscripción + generación de bracket sin admin) (Fase 3)
4. Modo espectador real, en vivo (Fase 4)
5. Formatos de torneo Suizo/Arena (Fase 3) — swiss/arena son valores de schema sin lógica

**Completar algo que ya está la mitad hecho**:
- Ritmos de tiempo configurables para Ajedrez (el reloj servidor-autoritativo ya existe, falta parametrizarlo)
- "Mejor jugada" en el análisis (el motor de evaluación ya existe, falta exponer la alternativa)
- Recompensas/XP real en misiones semanales (el cálculo ya existe, falta el gancho a logros/XP)
- Estados CONECTANDO/RECONECTANDO del propio jugador (el socket ya reconecta solo, falta el indicador visual)
- Índices de DB para elo/damasElo/result/endedAt

**Ya está bien y no hay que tocar**: Lobby, Perfil (estructura base), sonido, revancha/tablas/game-over de ambos juegos, seguridad de salas y rate limiting, Premium/PayPal, motor de Damas (recién corregido), accesibilidad base (`:focus-visible`), estados de botón (hover/disabled/loading ya existen en `theme.css`).

---

*Próximo paso: con esta auditoría, decidir con el usuario el orden real de implementación dentro del "ORDEN OBLIGATORIO" del roadmap (Temporadas → Blitz → Torneos → ... ), dado que Temporadas, Reloj de Damas y Auto-inicio de Torneos son, cada uno, un sistema nuevo de tamaño considerable.*
