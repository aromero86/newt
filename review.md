# Revisión: el manual frente al framework

Dos auditorías comprobaron, afirmación por afirmación, que la documentación dice lo
que hace `packages/newt`. Cada hallazgo se corrigió en el código, en los ejemplos o en
la documentación, con sus tests y una revisión, cada uno en su propio commit.

| Auditoría | Qué comprobó | Afirmaciones | Hallazgos | Abiertos |
|---|---|---|---|---|
| 1 | El manual de nuke (cd96ecb) frente al código de newt | ~270 | 18 | 0 |
| 2 | El manual, la guía, `stores.md` y los README de newt frente a su código | ~700 | 47 | 0 |

"Abiertos" cuenta los hallazgos que piden un cambio. Las dudas de diseño que la
documentación ya describe tal como son siguen en la lista de "para más adelante"; están
al final.

---

## Auditoría 1: el manual de nuke

### Corregido en el código

| Hallazgo | Commit |
|---|---|
| Un cuerpo que no es JSON daba un 500. Ahora es un 400 (`malformed_body`), y un cuerpo leído dos veces sigue siendo un 500. | `e269f45` |
| Una entidad que no cumple su propio schema daba un 400 que culpaba al cliente y enseñaba campos internos. Ahora es `InvalidEntity`, un 500. | `e269f45` |
| Una migración con un trigger no se podía aplicar en SQLite, ni una función `$$` en Postgres. | `59563c8` |
| El aviso de una cola que nadie atiende nunca llegaba tras un despliegue normal. Ahora se comprueba cada minuto, avisa una vez por cola y lee un recuento por cola (`Outbox.waiting()`). | `173832b` |
| `writesTo` solo contaba en el caso de uso raíz. Ahora cuenta para todo lo que se ejecuta por debajo del caso de uso que lo declara. | `d46335c` |
| Los mensajes de límite de `defineFilter` no se podían traducir. Ahora pasan por `setMessages`. | `d46335c` |

### Corregido en la documentación

En el commit `a7676e4`:
- cómo crece el `open` del contexto;
- `fromDTO` recibe la fila con su versión, ahora también en los tipos;
- los reintentos anidados;
- un worker se ejecuta sin actor;
- `{ error, code }` es el de la API;
- los recuentos de escrituras de Kysely en los servidores;
- qué espera `jobs.idle()`;
- los spans propios del worker;
- cuánto se esperan los procesos entre sí;
- solo SQLite rechaza una escritura fuera de una transacción.

La clave y el texto del aviso de la regla de escritura, y la regla por contexto, se
corrigieron en `d46335c` y `83ce86b`.

---

## Auditoría 2: la documentación de newt

### Corregido en el código

| Hallazgo | Commit |
|---|---|
| Un cambio deshecho (1000 → 1200 → 1000) seguía publicando su evento. Ahora una entidad sin nada que guardar no cuenta nada. | `e3c0671` |
| `jobs.idle()` esperado dentro de `runAsActor` pasaba ese actor a los jobs. Ahora los jobs se ejecutan desligados. | `e3c0671` |
| En SQLite, `connect` y luego `migrations.up()` no dejaban tablas de jobs. Ahora aplica también las del framework, como los servidores. | `e3c0671` |
| Una carpeta de migraciones que no se podía leer se tomaba como "sin migraciones". Ahora es un error. | `e3c0671` |
| Un job muerto no se podía relanzar, aunque el manual decía que sí. `outbox.retry(id)` lo hace, y es atómico en los servidores. | `e3c0671` |
| Al error de la regla de escritura le faltaba el `[write rule]` que tenía su aviso. Ahora el texto es el mismo en los dos modos. | `a48822a` |
| `SecretToken.from` lanzaba los issues de zod. Ahora lanza `InvalidSecretToken`, un 400 que nunca repite el token. | `a48822a` |
| Los tests de MySQL borraban una base de datos llamada `framework`, dijera lo que dijera la URL. Ahora usan la de la URL. | `a48822a` |

### Corregido en el ejemplo (despensa)

En el commit `412ee0d`:
- `reserve` y `release` registran cada operación una sola vez, aunque se solapen dos ejecuciones: la comprobación va dentro del guardado protegido;
- las marcas y categorías se pueden listar y leer;
- un pedido acepta el email con espacios alrededor;
- los capítulos 10, 15, 18 y 21 del manual enseñan ese código.

### Corregido en la documentación

En el commit `5897bdf`:
- **Manual, capítulos 1–10:**
  - qué puntos de entrada aparecen y dónde;
  - el bucle de `start()`;
  - la versión en un guardado que escribe;
  - `unique` es cosa del store de ficheros, mientras que los stores SQL confían en su índice;
  - `ieq` solo pliega A–Z;
  - el nombre único cubre el valor exacto;
  - `whoIs` con `sessionId`.
- **Manual, capítulos 11–19:**
  - los eventos por nombre;
  - el backoff real, unos 2,5 minutos con los valores por defecto;
  - los conflictos los reintenta primero el caso de uso;
  - la regla de escritura se aplica fuera de cualquier worker;
  - las dependencias no tienen ciclos (no "un árbol").
- **Manual, capítulos 20–31:**
  - el id de `saveRows`;
  - el test 29.2 recibe stock;
  - los valores de Kysely por store;
  - una variante de ShopBase para Kysely;
  - el fragmento de los stores de servidor;
  - un segundo contexto hipotético;
  - cuándo se ejecuta `job.claim`;
  - de dónde sale `analytics`;
  - `idle()` y fire-and-forget;
  - todo lo que comprueba newt-kit-eslint.
- **`stores.md`:**
  - la espera acotada se cumple donde las transacciones se turnan;
  - `ne` incluye los valores ausentes;
  - los requisitos del fixture del contrato;
  - `waiting()` en el store de ficheros.
- **`guide.md`:**
  - las sumas vuelven como texto en los servidores;
  - los guardados de otros productos esperan en los stores serie;
  - la regla de escritura comprueba casos de uso, y el lint cubre los repositorios.
- **README de newt-kit-eslint:** qué comprueba `queue-name`.

---

## Dudas conocidas que la documentación describe tal como son

Siguen en la lista de "para más adelante", pendientes de decisión:
- una colisión de único es un `ConcurrencyConflict`, así que un create se reintenta cuatro veces antes de responder;
- los ids del store de ficheros se limitan a letras, números, `.`, `-` y `_`;
- un `release` que compite con un `reserve` depende de la versión del pedido para acabar bien;
- una entidad que solo registra un evento, sin cambios, no publica nada;
- `seenEveryMs` controla a la vez las escrituras de "visto" y la comprobación de colas huérfanas.

---

# Revisión de bugs y correcciones (2026-10-26)

Diez revisores, uno por área, buscaron bugs reales, cada uno demostrado con un test que
fallaba. Encontraron 59 (13 graves). Correctores en paralelo, uno por área, los
arreglaron con un test cada uno. Después, tres rondas de verificadores independientes
revisaron las correcciones y encontraron más problemas, que también se arreglaron con
su test. La suite completa (958 tests) pasa en SQLite, ficheros, Postgres y MySQL.

## Qué cambió de comportamiento, a propósito
- Un cuerpo JSON necesita `Content-Type: application/json` (también `+json`); si no, 415.
- Una llamada a una transacción que ya terminó (sin esperar, una rama de `Promise.all`)
  falla: nunca se ejecuta fuera de ella.
- Los reintentos pertenecen al primer caso de uso de la cadena; cualquier
  `retryOnConflict: false` en ella los detiene para toda la cadena.
- El payload de un evento es `Json`, declarado con `type` (no `interface`).
- Postgres y MySQL funcionan en `READ COMMITTED`. El texto se ordena por punto de código
  cuando la columna lo indica: `COLLATE "C"` en Postgres, `utf8mb4_0900_bin` en MySQL.
- Los ids del store de ficheros tienen como mucho 100 caracteres.
- Un campo `json` vive en una columna JSON (MySQL); un DDL dentro de una transacción de
  MySQL la termina.

## Abierto, pendiente de decisión
- despensa: las marcas y categorías aceptan nombres que solo se diferencian en
  mayúsculas (los productos ya no).
- Una entidad con un schema `looseObject` guarda en sus datos las columnas sobrantes de
  la fila.
- Tras un rollback que el llamante captura, volver a guardar el mismo objeto puede
  publicar un evento que describe menos cambios de los que escribe (el reintento de un
  caso de uso recarga, así que no le afecta).
- `queue-name` juzga un objeto sin tipo por su nombre: `deps.orders.fulfil` cuenta como
  el módulo.
- Kysely en SQLite comparte la sentencia cacheada de bun con el código del usuario que
  recorre exactamente el mismo texto SQL.

---

# Decisiones (2026-10-26)

Se revisaron los puntos abiertos de arriba y las propuestas de `framework-ideas.md`.

## Hecho
- **R1** Una colisión de único es `DuplicateValue` (409 `duplicate_value`, con los campos cuando el store los sabe), y un caso de uso la reintenta una sola vez.
- **R4** Una entidad que registra un evento sin haber cambiado nunca lanza un error. Un cambio deshecho sigue sin publicar nada.
- **R5** `orphansCheckEveryMs`, que por defecto vale `seenEveryMs`.
- **R7** Un schema que guarda campos que no nombra (`looseObject`, `catchall`) se rechaza al construir la entidad.
- **R8** Una entidad cuyo guardado se deshizo no se vuelve a guardar: hay que leerla otra vez.
- **R9** `queue-name` pregunta al type checker si el objeto es el módulo.
- **R10** Kysely en SQLite usa sentencias propias.

## Descartado
- **R2** Los ids del store de ficheros se quedan como están.
- **R3** y **R6** Eran de despensa, que ya no está en el repositorio.

Las propuestas de `framework-ideas.md` llevan su estado en ese fichero.
