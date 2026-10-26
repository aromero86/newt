# C. Problemas comunes

Lo que ves, lo que suele significar y qué hacer. Los mensajes se citan tal como los
escriben newt y cooper. cooper sustituye algunos de los de newt al arrancar con
`setMessages` ([capítulo 3](./03-pages-and-errors)); cuando difieren, se dan los dos,
primero el de cooper. El de cooper es lo que ve una persona de la app; el de newt es lo
que ve un test o un script, ya que no pasan por `index.ts`. El `code` es el mismo en los
dos, y es aquello según lo que actúa un cliente.

## Guardar {#saving}

**"Someone else changed this a moment ago. Reload it and try again." / "Someone changed it in the meantime. Try again." (`concurrency_conflict`, 409)**
Dos guardados de la misma fila a la vez, y el caso de uso ya se ejecutó cuatro veces:
newt ejecuta un caso de uso otra vez desde el principio ante un `ConcurrencyConflict`,
hasta tres veces más, y solo el primero de una cadena. O bien la fila está muy
disputada, o bien el caso de uso dice `retryOnConflict: false` y por eso no se vuelve a
ejecutar. Con mucha contención sobre un valor (un contador), tómalo en el `before` del
guardado bajo un `guard`, para que los guardados se turnen en vez de chocar
([capítulo 7](./07-cards-and-a-counter)). Un caso de uso que no debe ejecutarse dos veces
mantiene `retryOnConflict: false` y deja que la persona lo intente otra vez
([capítulo 8](./08-two-people-one-card), [capítulo 18](./18-tenants-and-access)).

**"That is already taken: pick another one" / "There is already one with this name" (`duplicate_value`, 409)**
Un índice único (o el `unique` de una tabla) rechazó una fila: alguien tomó el valor
entre tu comprobación y tu guardado. `DuplicateValue` es un tipo de `ConcurrencyConflict`,
así que el caso de uso se ejecuta otra vez una vez; su propia comprobación encuentra
entonces la fila y responde con el error del módulo (`board.name_taken`). Si ves
`duplicate_value` en sí, el caso de uso no tiene una comprobación propia antes de
guardar: añade una, para dar la respuesta clara, y deja el índice como última palabra
([capítulo 6](./06-rules-over-rows)). Donde "dado dos veces" significa "dado una vez" (un
acceso concedido otra vez), captura `DuplicateValue` y responde lo que hay
([capítulo 18](./18-tenants-and-access)). Recuerda que `NULL` nunca es igual a `NULL` en
un índice: dilo como un valor cuando lo sea.

**"[guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard"**
Un guardado leyó filas en su transacción (en `before` o `after`, o con un `find` a través
del repositorio) y no nombró ningún `guard`. En SQLite parecería funcionar, porque las
transacciones se turnan; en Postgres no. Dale al guardado las claves que protege su
regla, ``guard: [`columns:${boardId}`]``, o `guard: []` cuando lo que lee no necesita
ninguna ([capítulo 6](./06-rules-over-rows)). Mientras una aplicación añade sus guards,
el `guardRule: 'warn'` de la base convierte el error en un aviso.

**Dos guardados rompen una regla sobre varias filas (dos columnas en la posición 3, once columnas en un tablero).**
El guardado comprueba la regla en `after`, pero protege una clave demasiado ancha,
demasiado estrecha, o normalizada de otra manera que como compara la regla (`Roadmap` y
`roadmap`). Normaliza la clave exactamente como compara los nombres la regla
([capítulo 6](./06-rules-over-rows)).

**Una fila creada entretanto se cuela por la comprobación (una tarjeta movida a una columna mientras se reordena).**
Una versión protege una fila que existe; una nueva no tiene. Comprueba el orden completo
en el `after` del guardado, bajo un guard, y llama a `this.conflict()` cuando alguien se
ha colado ([capítulo 8](./08-two-people-one-card)).

**"A write runs inside `store.transaction`"**
Algo escribió con la conexión de un `SqliteStore` (o con Kysely) fuera de un guardado. En
un repositorio, las escrituras van dentro de `save` o `saveRows`. Fuera de uno (un
script, un adaptador como `SqlAnalytics`), dentro de `store.transaction(…)`. Postgres y
MySQL no lo comprueban: ahí una escritura fuera de una transacción se ejecuta al
momento, por su cuenta. Envuélvela igual, para que el código funcione en cualquier store
([capítulo 15](./15-kysely)).

**"This call belongs to a transaction that has ended: …"**
Una llamada dentro de una transacción se dejó sin `await`, o una rama de un
`Promise.all` siguió ejecutándose después de que otra lanzara. Se ejecuta después de que
la transacción se confirmara o se revirtiera, y falla en vez de ejecutarse fuera de
ella. Pon `await` a cada llamada; el `no-floating-promises` del lint detecta la mayoría
([apéndice B](./b-module-anatomy)).

**"Waited 30000 ms for the store: a transaction holds it. …"**
Algo esperó demasiado su turno. La causa habitual es código que se ejecuta dentro de una
transacción y pide el store desde fuera de ella, así que se espera a sí mismo: un
guardado desde un callback que no está en la cadena de `await` del guardado (un
`EventEmitter`, un timer iniciado antes). Mueve ese trabajo a un worker
([capítulo 11](./11-reacting)).

**`database is locked`**
Otro proceso tuvo el bloqueo de escritura de SQLite más de 5 segundos: un script con una
transacción larga mientras el backend se ejecuta, por ejemplo. No se reintenta. Mantén
cortas las transacciones del script; con varios procesos escribiendo a la vez, pasa a
Postgres ([capítulo 27](./27-postgres)).

## La regla de escritura

**"[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo"**
Un caso de uso de un módulo guardó en otro sin pasar por un worker. Si fallara a medias,
nada lo terminaría. Haz que el segundo módulo reaccione a un evento del primero con una
suscripción `'handler'` ([capítulo 13](./13-another-context)). El trabajo sobre varios
módulos es una saga: ejecútala desde un worker, o a mano con `base.jobs.runAsWorker`
([capítulo 14](./14-sagas)). Si la persona necesita las dos escrituras en la respuesta,
di la excepción donde se ve, `@UseCase({ writesTo: ['access'] })`, con el motivo al lado,
y asegúrate de que un fallo entre las dos no deja nada a medio hacer
([capítulo 8](./08-two-people-one-card), [capítulo 17](./17-auth),
[capítulo 18](./18-tenants-and-access)). Un caso de uso llamado desde otro contexto es la
raíz de lo que hace en el suyo: la regla se cumple ahí como en cualquier otro
([capítulo 20](./20-wiring-contexts)). El `writeRule: 'warn'` de la base convierte el
error en un aviso mientras una aplicación pasa a la regla.

## Pedir dos veces

**"A request with this Idempotency-Key is still in progress: try again once it ends" (`idempotency_key_in_use`, 409)**
El cliente envió el mismo envío otra vez mientras el primero aún se ejecutaba (se cansó
de esperar), o llegaron a la vez dos peticiones con una clave nueva. Reintenta cuando
termine la primera; una clave en manos de una petición que murió queda libre otra vez
pasado un minuto ([capítulo 9](./09-idempotent-posts)).

**"This Idempotency-Key was sent before with another body: send a new key for another request" (`idempotency_key_reused`, 422)**
El cliente reutilizó una clave para una petición distinta. Es un error del cliente: haz
un `crypto.randomUUID()` nuevo por envío, y envía el mismo solo cuando envíes el mismo
envío otra vez ([capítulo 23](./23-frontends)). El cuerpo se compara byte a byte.

**El mismo POST enviado dos veces hizo dos tarjetas.**
La ruta no tiene la opción `idempotency`, el cliente no envió `Idempotency-Key`, o los
dos envíos distaron más de un día (`ttlMs`) ([capítulo 9](./09-idempotent-posts)).

**Una petición rechazada, enviada otra vez con la misma clave, se ejecuta otra vez.**
Es a propósito: lo que falla (un error lanzado, un 5xx) no se guarda, así que la misma
clave puede volver a intentarlo ([capítulo 9](./09-idempotent-posts)).

## Workers {#workers}

**Un job no se ejecuta nunca.**
Comprueba, por orden:
- ¿Dice la suscripción `strategy: 'handler'`? `'fire-and-forget'` no escribe ningún job,
  y se pierde si lanza ([capítulo 10](./10-events)).
- ¿Aceptó `when` el evento? Un evento que rechaza no deja ningún job
  ([capítulo 12](./12-failures)).
- ¿Arrancó el contexto su worker? `runContexts` arranca todos; un script que solo hace
  `open` de un contexto no ejecuta ningún worker ([capítulo 17](./17-auth)).
- En un test, ¿esperas con `base.jobs.idle()`, nunca con un sleep, y en el contexto
  correcto? Un job vive en el outbox del contexto que **publica** el evento: la
  reacción de boards a `tenant.created` se ejecuta en el worker de auth. Espera primero
  a los jobs de auth, luego a los de boards ([capítulo 20](./20-wiring-contexts)).
- ¿Se confirmó el guardado? Un job se escribe en la transacción del guardado: una
  reversión se lo lleva consigo ([capítulo 11](./11-reacting)).
- ¿Le toca ya? Un job que falló espera su backoff (10 s, doblando, hasta 15 minutos)
  ([capítulo 12](./12-failures)).

**"A handler of 'card.assigned' is named '<handler's module>.<use case it calls>.on.card.assigned', not '…'"**
Al arrancar: la cola no termina con el evento al que está suscrita, o no tiene la forma
`<módulo>.<caso de uso>.on.<módulo>.<evento>`. `newt/queue-name` lo detecta, y más, en el
editor ([capítulo 11](./11-reacting), [apéndice B](./b-module-anatomy)).

**"[JobQueue] N job(s) of '…' wait, and no worker serves that queue: was its handler renamed or removed?"**
Hay jobs esperando en una cola que ningún worker ha registrado. La cola nombra el
módulo, el caso de uso y el evento (`card.notifyAssignee.on.card.assigned`), así que
renombrar cualquiera de los tres deja los jobs antiguos esperando bajo el nombre
antiguo. Devuelve el nombre a su sitio hasta que terminen, o escribe un script que haga
lo que esos jobs debían hacer ([capítulo 11](./11-reacting)).

**Un job se ejecuta dos veces, y su efecto se ve dos veces.**
Un job se ejecuta al menos una vez, así que quizá más: un worker que se paró a medias,
una concesión (lease) agotada. Haz que la segunda ejecución no encuentre nada que hacer,
y basa en el `id` del evento (el segundo argumento del handler, `EventMeta`) lo que sale
del proceso, el mismo en todas las ejecuciones
([capítulo 11](./11-reacting), [capítulo 13](./13-another-context)).

**Un job está `dead`.**
Se quedó sin intentos (5 por defecto). Su `lastError` dice por qué. Arregla primero la
causa, luego reinténtalo: la página Jobs del backoffice lista los jobs muertos de cada
contexto y los reintenta ([capítulo 26](./26-dead-jobs-and-analytics)); sin ella, los
casos de uso `outbox.dead` y `outbox.retry` del contexto, o el `outbox.retry(id)` del
store, hacen lo mismo ([capítulo 12](./12-failures)). Un job muerto de una saga es
trabajo atascado a medias: dale más `attempts` a esos jobs
([capítulo 14](./14-sagas)).

**"Job … is done, not dead: only a dead job is retried" (`outbox.job_not_dead`, 409)**
Alguien ya lo reintentó, o nunca estuvo muerto: uno que espera o se ejecuta va de camino.
Recarga la lista ([capítulo 12](./12-failures)).

**Un worker actúa sobre algo que ya no está (una tarjeta borrada desde su evento).**
Un job puede ejecutarse tarde. Vuelve a leer aquello de lo que trata antes de actuar, y
no hagas nada si ya no está ([capítulo 12](./12-failures), [capítulo 14](./14-sagas)).

**Una programación no hace tick nunca en un test.**
Las programaciones hacen tick con el reloj de la base. Mueve el reloj
(`{ now: () => new Date(time) }`), luego llama a `base.schedules.tick()`. Una
programación nueva espera a su siguiente tick: la primera llamada no dice nada de antes
([capítulo 19](./19-invitations-and-time)).

## Cosas que aparecen un momento después

**Un espacio de trabajo nuevo aún no tiene tableros; un miembro eliminado sigue siendo el asignado de una tarjeta; una tarjeta falta en la búsqueda.**
Cada cosa la hace un worker después de un evento (`tenant.created`, `access.revoked`,
`card.created`), un momento después. Diseña la pantalla para ese momento, y en los tests
espera a los jobs ([capítulo 13](./13-another-context), [capítulo 16](./16-search-port),
[capítulo 20](./20-wiring-contexts)). Si dura, busca un job muerto de esa cola entre los
del contexto que publica.

**La búsqueda de tarjetas encuentra tarjetas de antes de un reinicio, o se deja algunas, con dos procesos.**
La búsqueda en memoria es de un solo proceso: se reconstruye al abrirse boards, y es
incorrecta en cuanto hay dos. Un servidor de búsqueda es otro adaptador del mismo puerto
([capítulo 16](./16-search-port)).

## Quién y dónde

**"You are not signed in, or your session has ended: sign in to go on" / "Sign in to continue" (`not_signed_in`, 401)**
Una ruta que no es `public` se llamó sin sesión, o un caso de uso que lee
`currentActor()` se ejecutó sin actor (`NoActor`): un script o un test que lo llama fuera
de `runAsActor`. Una ruta pública que quiere saber quién está ahí pregunta
`findCurrentActor()`, que devuelve `undefined` en su lugar
([capítulo 4](./04-who-and-where), [capítulo 21](./21-oauth-server)).

**"No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one"**
Un repositorio de boards se ejecutó fuera de un espacio de trabajo. Una ruta entra en
uno a través del grupo del workspace; una herramienta MCP con `inWorkspace`; un worker o
un script con `runInWorkspace`. Para leer a través de espacios de trabajo a propósito, un
método del repositorio usa `findInEveryScope`
([capítulo 4](./04-who-and-where), [capítulo 24](./24-mcp-server)).

**Un miembro recibe 404 en un espacio de trabajo que existe.**
No pertenece a él: boards responde 404 para que un extraño no pueda saber que existe.
Comprueba su acceso en auth ([capítulo 4](./04-who-and-where), [capítulo 18](./18-tenants-and-access)).

**`Property 'via' is missing` donde se da un actor.**
cooper añade `via` (`'web'` o `'mcp'`) al `Actor` de newt, y es obligatorio. Cada
`runAsActor` y cada autenticador dicen cómo entró la persona:
`runAsActor({ userId, via: 'web' }, fn)` ([capítulo 4](./04-who-and-where),
[capítulo 24](./24-mcp-server)).

**Un test inicia sesión, pero las rutas ven a otra persona.**
Un router tiene un solo autenticador, y gana el último que se pone. Un test que quiere el
suyo lo pone después de que el contexto se abra ([capítulo 22](./22-web-session)).

**El secreto de una entidad aparece en una respuesta o en un evento.**
La entidad no tiene esquema público. `Entity<typeof Kept, typeof Public>` hace que
`toDTO()` dé solo los campos públicos ([capítulo 17](./17-auth)).

## Migraciones

**"Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration"**
El store guarda un checksum de cada migración aplicada y se niega a abrir cuando una ha
cambiado. Devuelve el archivo a su estado (`git checkout`), y escribe el cambio como la
siguiente migración ([capítulo 5](./05-sqlite), [capítulo 18](./18-tenants-and-access)).
Los finales de línea no cuentan: un checkout que convierte `\n` en `\r\n` no cambia nada.

**"Migrations … and … share the version …: renumber one"**
Dos ramas añadieron cada una una migración con el mismo número. Renumera la tuya, la que
no se ha aplicado todavía en ningún sitio ([capítulo 27](./27-postgres)).

**"Last applied migration … is not in the migrations folder"**
La base de datos va por delante del código: volviste a una rama sin una migración que ya
aplicó. Vuelve a avanzar, o deshaz esa migración con `down` desde la rama que la tiene
([capítulo 27](./27-postgres)).

**"The migrations folder '…' cannot be read"**
La ruta dada al store es incorrecta, o apunta a la carpeta del otro dialecto. newt se
niega a tratarlo como "sin migraciones" ([capítulo 27](./27-postgres)).

**Una tabla funciona en SQLite y no en Postgres.**
Cada dialecto tiene su propia carpeta de migraciones, `migrations/sqlite/` y
`migrations/postgres/`: una migración nueva va en las dos ([capítulo 27](./27-postgres)).

## El navegador

**`Module "node:async_hooks" has been externalized for browser compatibility, imported by ".../packages/newt/core/scope/define-scope.ts"`**
Un frontend arrastró `newt/core`, a través de un esquema o un objeto de valor que lo
importa. Un navegador no tiene `node:async_hooks`. Un `*.schema.ts` y sus objetos de
valor importan `newt/contract`, nunca `newt/core` ([capítulo 23](./23-frontends)).

**Un cliente muestra un mensaje que ha cambiado, o se rompe cuando cambia.**
Actúa según el mensaje. Actúa según `code`, que nunca cambia; lee cada fallo como un
`ErrorBody` ([capítulo 3](./03-pages-and-errors), [capítulo 23](./23-frontends)).

**Una llamada entre orígenes falla, o no envía ninguna cookie.**
La ruta no dice `cors`, o depende de cookies entre orígenes. Una ruta a la que llaman
otras páginas lo dice con `cors`, y demuestra quién llama con un token, nunca con una
cookie ([capítulo 21](./21-oauth-server), [capítulo 24](./24-mcp-server)).

## Ejecutar cooper

**"…: port 3002 is already in use" y "Nothing was started."**
`bun run cooper` comprueba primero todos los puertos. Otro cooper, u otra cosa, está
escuchando. Páralo, o mueve cooper con las variables `COOPER_*_PORT` y
`COOPER_*_PUBLIC_URL`; en desarrollo los proxies de los servidores Vite leen los mismos
`COOPER_*_PORT` ([capítulo 23](./23-frontends), [capítulo 29](./29-shipping)).

**Una página responde "The frontend is not built: its folder has no index.html".**
Has abierto el puerto propio de un contexto sin construir los frontends. En desarrollo,
abre las URLs de los servidores Vite (5171, 5172, 5173). En producción, ejecuta primero
`bun run cooper:build` ([capítulo 23](./23-frontends), [capítulo 29](./29-shipping)).

**El lint se detiene antes de lintear nada: "newt-eslint: contexts never use each other in a cycle, …"**
El `contexts.uses` de `eslint.config.js` nombra un contexto que no lista, o forma un
ciclo ([apéndice B](./b-module-anatomy#newt-context-boundaries)).

**Nada se traza.**
No se puso ningún tracer, o cada contexto recibió el suyo: da un solo tracer a
`runContexts`, para todos los contextos del proceso ([capítulo 28](./28-observability)).
