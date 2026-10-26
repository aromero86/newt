# C. Problemas frecuentes

Lo que ves, lo que suele significar y qué hacer. Los mensajes están citados tal como los
escriben newt y cooper, en inglés.

## Guardar

**"Someone changed it in the meantime. Try again." (`ConcurrencyConflict`, 409)**
Dos guardados de lo mismo a la vez, y el caso de uso ya lo intentó cuatro veces (o dice
`retryOnConflict: false`). Si es una fila nueva que choca con un valor único (dos
tableros llamados "Roadmap"), es la protección funcionando: cooper convierte ese caso en
`board.name_taken`, y el usuario elige otro nombre. ([capítulo 7](./07-concurrency))

**Dos guardados rompen una regla sobre varias filas: dos admins, dos cards con el #7.**
El guardado que comprueba la regla en su `after` no protege lo que vigila. Añade su
clave: `guard: ['cardNumbers:<board>']`. En SQLite parece funcionar sin ella, porque los
guardados se turnan de todos modos; en Postgres y MySQL, no.
([capítulo 8](./08-rules-over-rows))

**"A write runs inside `store.transaction`"**
Algo ha escrito con la conexión de un `SqliteStore` (o con Kysely) fuera de un guardado.
En un repositorio, las escrituras van dentro de `save` o `saveRows`. Fuera de él (un
script, un adaptador como `SqliteAnalytics`), dentro de `store.transaction(…)`. Postgres
y MySQL no lo comprueban: allí una escritura fuera de una transacción se hace al momento,
sola. Envuélvela igual, para que el código valga en cualquier store.

**"Waited 30000 ms for the store: a transaction holds it."**
Algo esperó demasiado su turno. La causa habitual es código que se ejecuta dentro de una
transacción y pide el store desde fuera de ella, de modo que se espera a sí mismo. Pasa al
guardar desde un callback que no está en la cadena de `await` del guardado (un
`EventEmitter`, un temporizador lanzado antes). Lleva ese trabajo a un worker.

**`database is locked`**
Otro proceso tuvo el bloqueo de escritura de SQLite más de 5 segundos: un script con una
transacción larga mientras corre el backend, por ejemplo. No se reintenta. Haz cortas las
transacciones del script. ([capítulo 26](./26-production))

## La regla de escritura

**"[write rule] … writes to … outside a worker: write it from a worker reacting to an event, or list it in its writesTo"**
Un caso de uso de un módulo ha guardado en otro sin pasar por un worker. Si falla a
mitad, nada lo terminará. Haz que el segundo módulo reaccione a un evento del primero con
un `handler`. Si la excepción está justificada, dila donde se vea:
`@UseCase({ writesTo: ['column'] })`, con el motivo al lado, como hace
`card.removeColumn`. ([capítulo 17](./17-modules-talk))

## Workers

**Un worker no se ejecuta.**
¿Has llamado a `start()` del contexto? ¿La suscripción dice `strategy: 'handler'`, y no
`'fire-and-forget'`? En un test o en un script, ¿esperas con `jobs.idle()`, y en el
contexto correcto? El job vive en el outbox del contexto que **publica** el evento: la
reacción de boards a `tenant.created` corre en el worker de auth.
([capítulo 25](./25-tests))

**`A handler of '…' is named '<handler's module>.<use case it calls>.on.…', not '…'`**
Al arrancar: la cola no acaba con el evento al que se suscribe, o no tiene la forma
`<módulo>.<caso de uso>.on.<evento>`. `newt/queue-name` lo pilla antes, en el editor.
([capítulo 11](./11-reacting))

**"[JobQueue] N job(s) of '…' wait, and no worker serves that queue: was its handler renamed or removed?"**
Hay jobs en una cola que ningún worker atiende desde hace cinco minutos. El nombre de la
cola dice el módulo, el caso de uso y el evento (`metric.recordCard.on.card.created`),
así que renombrar cualquiera de los tres deja los jobs viejos esperando con el nombre
antiguo. Vuelve a poner el nombre, o escribe un script que haga lo que debían hacer esos
jobs.

**Un job está `dead`.**
Agotó sus intentos. Mira su `lastError` en `store.outbox.list()`, corrige la causa y
devuélvelo a la cola con `store.outbox.retry(id)`. Un job muerto es un flujo atascado a
mitad: el [capítulo 16](./16-sagas) cuenta cómo pensarlo.

## Cosas que aparecen un momento después

**Un espacio de trabajo nuevo no tiene tableros.**
Su tablero de bienvenida lo crea un worker tras `tenant.created`. Aparece un momento
después. Diseña la pantalla para ese momento. ([capítulo 12](./12-eventual-consistency))

**Alguien a quien sacaron de un espacio sigue asignado a una card.**
Durante un momento es normal: un worker desasigna la card tras `access.revoked`. Si dura,
busca un job `card.unassignMember.on.access.revoked` muerto en el outbox de auth.

**Los números del backoffice van por detrás.**
Son una proyección, escrita por workers tras los eventos de auth y boards. Si siguen por
detrás, busca jobs `metric.*` muertos en los outbox de auth y de boards.
([capítulo 22](./22-backoffice))

## Quién y dónde

**"Sign in to continue" (`not_signed_in`, 401)**
Se llamó a una ruta que no es `public` sin sesión, o un caso de uso que lee
`currentActor()` se ejecutó sin actor: un script o un test que lo llama fuera de
`runAsActor`.

**"No workspace here: a route under /workspaces/:workspaceId, inWorkspace or runInWorkspace enters one"**
Un repositorio de boards se ejecutó fuera de un espacio de trabajo. Una ruta entra en él
por el grupo del espacio; una herramienta MCP, con `inWorkspace`; un worker o un script,
con `runInWorkspace`. ([capítulo 5](./05-who-and-where))

**Un miembro recibe un 404 de un espacio que existe (`workspace.not_found`).**
No pertenece a él: boards responde 404 para que un extraño no sepa que existe. Revisa su
acceso en auth.

**Alguien del staff recibe un 403 en el backoffice (`staff.not_staff`).**
Le quitaron el acceso al producto `backoffice`, quizá después de entrar. El backoffice lo
comprueba en cada petición. Otra persona del staff puede volver a dárselo.

**Entrar en el backoffice se para en auth con `oauthGrant.no_access`.**
La cuenta no es del staff: el producto `backoffice` solo deja entrar a quien se le ha
dicho. Alguien del staff se lo da desde la página de staff del backoffice, o el seed crea
el primero.

## Migraciones

**"Migrations … and … share the version …: renumber one"**
Dos ramas añadieron cada una una migración con el mismo número. Renumera la tuya, la que
aún no se ha aplicado en ningún sitio. ([capítulo 24](./24-migrations))

**"Last applied migration … is not in the migrations folder"**
La base de datos va por delante del código: has vuelto a una rama sin una migración que
ella ya aplicó. Vuelve hacia delante, o deshaz esa migración con `down` desde la rama que
la tiene.

**"The migrations folder '…' cannot be read"**
La ruta que se le dio a `open` está mal. newt se niega a tratarla como "no hay
migraciones".

**Una columna que añadiste a una migración no está.**
Editaste una migración que ya estaba aplicada: la base de datos nunca la vuelve a
ejecutar. Escribe una nueva. ([capítulo 24](./24-migrations))

## Arrancar cooper

**"…: port 3002 is already in use" y "Nothing was started."**
`bun run cooper` comprueba antes todos los puertos. Hay otro cooper, u otra cosa,
escuchando. Páralo, o mueve cooper con las variables `COOPER_*_PORT` y
`COOPER_*_PUBLIC_URL`. ([capítulo 26](./26-production))

**Una página responde "The frontend is not built: its folder has no index.html".**
Has abierto el puerto de un contexto sin compilar los frontends. En desarrollo, abre las
URLs de los servidores de Vite (5171, 5172, 5173). En producción, ejecuta antes
`bun run cooper:build`.

**El seed falla al leer el enlace de la invitación de Bob.**
El backend estaba en marcha, y su worker mandó el email antes que el del seed. Para el
backend y vuelve a ejecutar el seed. ([capítulo 26](./26-production))
