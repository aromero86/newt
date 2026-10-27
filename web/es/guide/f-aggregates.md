# F. Agregados

Un agregado es un grupo de datos que cambian juntos, bajo reglas que deben cumplirse
cada vez que se guarda. La idea viene del libro de Eric Evans *Domain-Driven Design*
(2003). Vaughn Vernon la convirtió en cuatro reglas prácticas en su ensayo *Effective
Aggregate Design* (tres partes, 2011) y en el capítulo 10 de *Implementing
Domain-Driven Design* (2013). newt se construye sobre esas reglas, y se aparta de
ellas en un punto, a propósito.

Este apéndice enuncia las reglas de Vernon, muestra dónde vive cada una en newt y en
cooper, dice dónde newt hace otra cosa y qué cuesta, y compara el modo de newt con las
otras formas de mantener agregados. Termina con cómo encontrar un límite en una app de
newt, y los errores que lo rompen.

## Las reglas de Vernon, en breve

1. **Modela las invariantes verdaderas dentro de límites de consistencia.** Una
   invariante es una regla que debe ser cierta después de cada transacción, no
   "con el tiempo" (un tablero nunca tiene más de diez columnas). El agregado se
   dibuja alrededor de los datos que esa regla necesita, y nada más. Su raíz es la
   única entidad con la que habla el exterior.
2. **Diseña agregados pequeños.** Uno grande carga más de lo que necesita un caso de
   uso, y cada cambio en cualquiera de sus partes choca con todos los demás. La
   mayoría de los agregados son una entidad raíz y unos pocos valores.
3. **Referencia otros agregados por identidad.** Un agregado guarda el id de otro,
   nunca el objeto. Así no puede cambiar al otro por accidente, y cada uno se puede
   cargar, guardar y escalar por separado.
4. **Usa consistencia eventual fuera del límite.** Cuando un cambio en un agregado
   tiene una consecuencia en otro, el primero publica un evento de dominio, y el
   segundo cambia más tarde, en su propia transacción.

Detrás de las reglas 2 y 4 hay una regla práctica: **modifica una instancia de
agregado por transacción**. Vernon la trata como una regla práctica, no como una ley.
El libro enumera las razones por las que los equipos la rompen (una interfaz de
usuario que edita varios a la vez, la falta de medios técnicos como la mensajería, una
empresa que exige transacciones globales, el rendimiento de las consultas), y te pide
romperla con conocimiento.

Cómo protege la raíz al resto es diseño de objetos clásico: quien llama le pide algo a
la raíz, y la raíz cambia sus partes y comprueba sus reglas. La concurrencia se
resuelve con una versión por agregado: dos transacciones que cargaron la misma versión
no pueden confirmar las dos.

## Cómo se corresponde newt

| Vernon | newt | Capítulo |
|---|---|---|
| Un agregado, con su raíz | Un módulo, con su entidad | [2](./02-first-module) |
| Solo la raíz cambia sus partes | Solo la entidad se cambia a sí misma (`change()` es protected); solo el repositorio toca el store | [2](./02-first-module) |
| Una versión por agregado | Una `version` por fila de la entidad, comprobada en cada guardado | [8](./08-two-people-one-card) |
| Un agregado por transacción | Un guardado es de un solo módulo; la regla de escritura rechaza un caso de uso que guarda en dos | [6](./06-rules-over-rows), [8](./08-two-people-one-card) |
| Referencia por identidad | Las referencias son ids, comprobados preguntando al otro módulo | [7](./07-cards-and-a-counter) |
| Consistencia eventual fuera | Eventos, escritos en el outbox en la transacción del guardado; workers `handler` | [10](./10-events), [11](./11-reacting), [13](./13-another-context) |
| Procesos largos | Sagas, ejecutadas desde workers hasta que convergen | [14](./14-sagas) |

### Un módulo es un agregado

Un módulo es dueño de una entidad, su tabla y las reglas sobre ella. La entidad es la
raíz: sus métodos son la única forma de cambiarla, y cada uno dice qué ha pasado con
un evento. La página de reglas lo dice en una línea: lo que debe guardarse junto,
todo o nada, es un módulo ([las reglas](../reference/rules#how-modules-talk)).

newt añade una restricción que Vernon no necesita: una entidad por módulo. Un agregado
en el sentido de Vernon puede contener entidades hijas (un pedido y sus líneas). En
newt, una segunda entidad es un segundo módulo, salvo que se guarde como parte de la
primera (un valor, o filas que escribe su propio repositorio, como permite
`Repository`). Eso te empuja hacia agregados pequeños por construcción.

### Un agregado por transacción: la regla de escritura

Una transacción en newt es un guardado, `repo.persist(...)`, nunca un caso de uso
entero. Un repositorio guarda solo las entidades de su propio módulo, así que un
guardado nunca abarca dos módulos. Queda el caso de uso: podría llamar a dos módulos
que guardan cada uno, y fallar entre los dos. La regla de escritura lo detecta al
ejecutarse. Un caso de uso del módulo B que guarda, llamado desde un caso de uso del
módulo A fuera de un worker, lanza:

```text
[write rule] card.create writes to boards.column outside a worker: write it from a worker reacting to an event, or list it in its writesTo
```

(El caso de uso y los módulos son los que la hayan roto.) Es la regla práctica de
Vernon convertida en una comprobación, con su "rómpela con conocimiento" escrito junto
al código. cooper tiene unas pocas excepciones así, cada una con su motivo. Quitar una
columna pregunta primero a las tarjetas, porque solo ellas saben si queda alguna en
ella, y luego hace que el módulo de columnas la quite:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }
```

Sigue guardando un solo agregado: la única escritura es la del módulo de columnas.
`writesTo` deja que un caso de uso escriba en otro módulo; no convierte dos guardados
en una sola transacción. `tenant.create` y `tenant.delete` de auth son la otra clase
de excepción: dos guardados a propósito, cada uno con un worker que termina el segundo
si falla ([capítulo 18](./18-tenants-and-access)).

Todo lo demás que escribe en otro módulo se ejecuta desde un worker, donde la regla lo
permite. Aun así no deja que dos módulos compartan una transacción, en un worker o
fuera de él: el guardado de un segundo módulo en una transacción que ya guardó otro
(desde un hook de guardado, o con dos guardados dentro de un `store.transaction`)
también se rechaza, salvo que el caso de uso con el que empezó la cadena liste los dos
en su `writesTo` (de nuevo con los nombres de quien la rompa):

```text
[write rule] card.create saves boards.board in the transaction that saved boards.card: one module per transaction; save it after that one commits, from a worker reacting to an event, or list it in its writesTo
```

Así que un worker guarda un módulo tras otro, cada uno en su propia transacción, y un
job que falla a medias se ejecuta otra vez hasta completarse. Es la regla práctica de
Vernon en su forma estricta: un agregado por transacción, lo ejecute quien lo ejecute.

### La versión: concurrencia optimista en el límite

Toda entidad tiene una `version`. Un guardado escribe solo lo que cambió, y solo si la
fila sigue con la versión con la que se leyó; si no, lanza `ConcurrencyConflict` y no
escribe nada. Es la concurrencia optimista de Vernon sobre la raíz, con una fila en
lugar de un grafo de objetos.

newt hace entonces lo que el libro de Vernon deja a la aplicación: un caso de uso que
choca con un conflicto se ejecuta de nuevo desde el principio, hasta tres veces más,
leyendo lo que hay guardado ahora. Por eso un caso de uso se escribe como "cargar,
decidir, cambiar, guardar", sin nada que no se pueda deshacer antes del guardado:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  @UseCase()
  async edit(id: string, input: unknown): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes, actingAuthor())
    await this.repo.persist(card)
    return card.toDTO()
  }
```

Solo el primer caso de uso de una cadena se ejecuta de nuevo, con todo lo que llama.
Uno que no debe ejecutarse dos veces dice `@UseCase({ retryOnConflict: false })`, con
su motivo ([capítulo 8](./08-two-people-one-card)).

### Referencias por identidad

Una tarjeta apunta a su tablero, su columna y su asignado por id, y su esquema dice de
quién es cada uno. El módulo de tarjetas conoce esos módulos (sus deps) y les
pregunta; nunca lee sus tablas ni guarda sus entidades:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  /** auth taking someone's access away: their cards are left unassigned. */
  auth: {
    access: Access_Module
  }
}
```

En una escritura, el caso de uso comprueba una referencia llamando al caso de uso del
dueño, una lectura (`assertColumnOf`, `assertMember`, o `this.resolveRefs` para "¿existe?").
Esa comprobación queda fuera de la transacción de la tarjeta, como debe ser: la columna
es otro agregado. Así que una referencia puede apuntar a algo que se quita un momento
después. newt lo acepta, y hace que el módulo que apunta siga el evento del dueño, que
es la cuarta regla de Vernon.

### Consistencia eventual: eventos a través del outbox

Una entidad anota sus eventos al cambiar (`trackEvent`); su repositorio los publica en
el guardado. Una suscripción `handler` escribe un job en el outbox del store, en la
misma transacción, así que el cambio y el job se guardan juntos o no se guardan. Un
worker ejecuta el job tras el commit, y otra vez con un backoff hasta que lo consigue.
Eso es el outbox transaccional: el "publicar tras el commit" que pide el libro de
Vernon, sin un message broker ni una transacción distribuida.

Las tarjetas siguen a las columnas así:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // A card points at its column: when a column goes, no card is left in it. A card
  // checks its column before its save, so the column may go in between: a card
  // created in one, or moved to one, looks again once saved. Whichever looks last finds it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })
  cards.events.created.subscribe(card => cards.leaveRemovedColumn({ id: card.columnId, boardId: card.boardId, workspaceId: card.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.created',
  })
  cards.events.moved.subscribe(({ dto }) => cards.leaveRemovedColumn({ id: dto.columnId, boardId: dto.boardId, workspaceId: dto.workspaceId }), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.card.moved',
    when: ({ changes }) => changes.columnId !== undefined,
  })
```

Seguir solo el evento de la columna dejaría un hueco. Una tarjeta comprueba su columna
antes de su guardado, fuera de la transacción de la columna, así que la columna puede
quitarse entre medias: su worker se ejecuta después del commit de la columna, busca
tarjetas en ella y no encuentra ninguna, porque el guardado de la tarjeta aún no ha
hecho commit. Después la tarjeta hace commit, en una columna que ya no está. Por eso la
tarjeta sigue también sus propios eventos: cuando se crea una tarjeta en una columna,
o se mueve a una, un job vuelve a mirar. Cada seguidor se ejecuta después de su propio
commit y comprueba el estado del otro lado, no lo que dijo el evento; el que corre el
último ve los dos commits, así que los dos convergen en cualquier orden.
`leaveRemovedColumn` no hace nada mientras la columna sigue ahí.

Un job puede ejecutarse más de una vez, así que toda reacción es idempotente: la
segunda vez, `leaveRemovedColumn` no encuentra ninguna tarjeta en la columna quitada y
no hace nada ([capítulo 13](./13-another-context)). A un asignado se le sigue igual:
`unassignMember` se ejecuta con el `access.revoked` de auth y con una tarjeta creada
para alguien o asignada a alguien, y no hace nada mientras esa persona siga
perteneciendo al workspace, así que quien vuelve a entrar conserva sus tarjetas. Lo mismo funciona entre contextos:
boards sigue el `access.revoked` de auth a través del módulo de accesos de auth, y el job está en el
outbox de auth ([capítulo 20](./20-wiring-contexts)).

### Sagas, desde workers

Un trabajo sobre varios agregados es una secuencia de guardados, cada uno su propia
transacción. En newt es un caso de uso que ejecuta un worker, con cada paso seguro de
repetir. El tablero de bienvenida de boards es un tablero, tres columnas y una
tarjeta, escritos cuando auth avisa `tenant.created`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
  deps.auth.tenant.events.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
```

`workspace.prepare` escribe en tres módulos, algo que solo un worker puede hacer. Si
se detiene a medias, su job lo ejecuta otra vez, y cada paso encuentra lo que hizo la
ejecución anterior (`findByName`, `addMissing`, `createFirst`), así que converge
([capítulo 14](./14-sagas)). Vernon lo llamaría un proceso de larga duración; la
literatura de patrones lo llama saga o process manager.

## Dónde se aparta newt

### El límite de un guardado es un módulo, no una instancia

La regla práctica de Vernon habla de instancias: un pedido por transacción. La de newt
habla de módulos: un guardado escribe entidades de un solo módulo, tantas como se le
den, todas o ninguna. cooper lo usa cada vez que algo tiene un orden. Mover una
columna reescribe las posiciones de las otras columnas de su tablero; mover una
tarjeta reescribe las posiciones de las tarjetas de alrededor. Cada una son varias
filas, cada una con su propia versión, en un guardado.

En los términos de Vernon, esas columnas son varios agregados guardados en una
transacción. En los de newt, son filas de un módulo, y el guardado es el límite. La
pregunta que responde el guardado es la de la regla 1 de Vernon: ¿qué filas deben ser
consistentes entre sí para este cambio? Aquí, las columnas de un tablero.

### Reglas sobre varias filas: un guard con nombre

Una versión protege una fila contra alguien que cambió esa fila. No protege una regla
que lee varias filas, porque nadie cambió las filas que leíste: alguien añadió otra.
"Un tablero tiene como máximo diez columnas" es una regla así. Diez peticiones que
añaden cada una una columna a un tablero de cinco cuentan cinco cada una, y cada una
guardaría.

La respuesta de Vernon es poner la regla dentro de un agregado. Board sería dueño de
sus columnas: `board.addColumn(name)` comprueba el recuento, y la versión de Board
hace que dos altas choquen. Es un buen diseño, y con diez columnas como máximo, Board
sigue siendo pequeño. O aceptaría la regla como consistente a la larga, y arreglaría
la columna número once después.

newt mantiene Column como un módulo propio (las tarjetas apuntan a las columnas por
id, y las columnas tienen sus propios eventos), y protege la regla dentro del guardado
de la columna. El guardado nombra lo que protege la regla, su **guard**, cuenta otra
vez dentro de la transacción, y lanza para revertir:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  async persistAdded(column: Column): Promise<void> {
    const { boardId } = column
    await this.save([column], each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => column.place(await this.count({ boardId })),
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
      },
    })
  }
```

El guard es un bloqueo con nombre que se mantiene hasta que termina la transacción.
Los guardados que protegen `columns:<board>` esperan su turno; todos los demás se
ejecutan en paralelo. En SQLite y ficheros cada transacción espera su turno de todos
modos; en Postgres y MySQL el guard es un bloqueo advisory (`pg_advisory_xact_lock`,
`GET_LOCK`) en una transacción READ COMMITTED, así que el recuento de `after` ve lo
que confirmó el último que tuvo el guard ([capítulo 6](./06-rules-over-rows)).

Lee la clave como el nombre de un límite de consistencia. `columns:<board>` es
exactamente el agregado que dibujaría Vernon, "las columnas de un tablero", sin una
clase para él. La misma forma protege:

- **Un nombre libre en su workspace.** `persistWithNameFree` protege
  `boardName:<workspace>:<name in lower case>` y cuenta en `after` los tableros con
  ese nombre. Vernon lo llama validación de conjunto, y no tiene un buen hogar en un
  solo agregado: un Workspace que fuera dueño de todos los tableros sería el agregado
  grande contra el que avisa la regla 2. El guard es tan estrecho como la regla: dos
  nombres distintos nunca esperan.
- **El siguiente número de tarjeta.** El último número de cada tablero es una fila de
  `card_counter`, que se sube en uno en el guardado de la tarjeta, en `before`, bajo
  `boardCards:<board>` ([capítulo 7](./07-cards-and-a-counter)). Vernon pondría el
  contador en Board, y cada tarjeta nueva chocaría con todas las demás en la versión
  de Board. Bajo el guard, esperan su turno, y ninguna es rechazada.
- **Un orden.** `persistOrder` protege las columnas que toca y comprueba en `after`
  que las posiciones son 0, 1, 2… sin huecos. Una tarjeta creada mientras tanto no
  tiene versión en este guardado, así que la comprobación la encuentra, y
  `this.conflict()` hace que el caso de uso se ejecute de nuevo
  ([capítulo 8](./08-two-people-one-card)).

El número es el caso más claro de para qué sirve el guard:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
        // Its board's first, and another one got in first: the use case runs again, and finds it.
        if (options.first && count > 1) this.conflict()
      },
    })
  }
```

### La regla del guard, y el compilador

Una regla que se cumple en SQLite solo porque SQLite espera turnos se rompe, sin que
se vea, el día que el contexto pasa a Postgres. newt hace que un guard ausente se note
de dos maneras. Un guardado con `after` no compila sin `guard` (`guard: []` dice,
donde se lee, que no hace falta ninguno). Y la regla del guard hace fallar un guardado
que no protege nada y lee filas en su transacción, en todos los stores, SQLite también:

```text
error: [guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard
```

Lo que no puede detectar es un guard que nombra lo que no es: una clave demasiado
estrecha, o dos guardados que protegen una regla con dos nombres. La clave la eliges
tú.

### Un índice único tiene la última palabra

Un valor que no comparten dos filas (el nombre de un tablero, el número de una tarjeta
en su tablero) tiene además un índice único. Si dos guardados se cuelan alguna vez
por la regla, el segundo falla con `DuplicateValue`, un `ConcurrencyConflict` propio.
El caso de uso se ejecuta de nuevo una vez, su propia comprobación encuentra el valor
ocupado, y responde con su propio error (`board.name_taken`). El guard mantiene la
regla; el índice asegura que un error en ella no pueda guardar datos malos
([capítulo 6](./06-rules-over-rows)).

### El caso de uso comprueba primero, el guardado comprueba otra vez

Un caso de uso comprueba una regla antes de guardar, para dar una respuesta clara en
el caso habitual; el guardado la comprueba otra vez donde nada se cuela. En el diseño
de Vernon la comprobación se escribe una vez, en el método del agregado. En newt una
regla sobre varias filas se escribe dos veces: una en el caso de uso, otra en el hook
del guardado.

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
```

### Qué cuesta

Sé claro con el intercambio:

- **La invariante vive en el repositorio, no en la entidad.** `Board` no sabe nada de
  "como máximo diez columnas"; `Column_Repository.persistAdded` sí. Quien busca las
  reglas de un módulo lee su entidad, sus casos de uso y los hooks de guardado de su
  repositorio. El diseño de Vernon las pone todas en la raíz.
- **Se prueba contra un store.** La regla de un agregado es un test unitario de una
  clase. Una regla con guard es un test que ejecuta guardados a la vez sobre un store
  real (los tests de columnas de cooper añaden ocho columnas a la vez a un tablero de
  cinco, y esperan que entren cinco).
- **Un guard espera; una versión falla.** Los guardados con una misma clave hacen cola.
  Eso es mejor que conflictos y reintentos para una clave caliente (el contador de
  tarjetas), y peor si un guardado retiene la clave mucho tiempo: todo lo que hay
  detrás espera, hasta el límite de espera del store.
- **El bloqueo se nombra por convención.** Nada une `columns:<board>` al módulo de
  columnas salvo la cadena. Dos repositorios podrían usar el mismo nombre y esperarse
  entre sí, o dos guardados de una misma regla podrían usar nombres distintos y no
  esperarse en absoluto.
- **Un seguidor vigila los dos lados.** Una referencia comprobada antes del cambio del
  dueño, y guardada después, se le escapa al seguidor del dueño si este corre
  primero. cooper lo cierra siguiendo también sus propios eventos (`card.created`,
  `card.moved`, `card.assigned`), con cada reacción comprobando el estado del otro
  lado: una suscripción por lado, y reacciones que leen en vez de fiarse del evento.
  La consistencia eventual es tan buena como las reacciones que la cierran.
- **Sigue siendo un solo store.** Un guard funciona porque las filas están en una
  base de datos. No es una forma de saltarse la regla 4: una regla sobre datos de dos
  contextos es consistente a la larga, por eventos, como dice Vernon.

Lo que compra: agregados pequeños (una entidad por módulo, una fila por entidad),
reglas sobre conjuntos sin una clase que contenga el conjunto, un contador caliente
sin colisiones, y el mismo código en todos los stores.

## Otras formas de mantener agregados

El mismo problema, resuelto de siete maneras. La de newt es una de ellas.

| | Dónde viven las invariantes | Concurrencia | Entre agregados | Facilidad de test | Escalado | Curva de aprendizaje |
|---|---|---|---|---|---|---|
| **(a) newt** | Métodos de la entidad; reglas de conjunto en los hooks del guardado | Versión por fila; guards con nombre para conjuntos; reintento en conflicto | Eventos, outbox transaccional, workers | Casos de uso contra un store real, a la vez | Un store por contexto; los guards estrechan las esperas | Moderada: pocas reglas, comprobadas |
| **(b) Grafos de objetos con ORM** | Los métodos de la raíz, sobre hijos cargados | Versión en la raíz, bloqueos de fila | A menudo una transacción compartida | Tests unitarios del grafo; integración para el mapeo | Los grafos grandes cargan y bloquean mucho | Alta: el comportamiento del ORM |
| **(c) Transaction scripts** | El servicio y la base de datos | Bloqueos de fila, `SELECT … FOR UPDATE`, restricciones | Una transacción para todo | Sobre todo tests de integración | Bien hasta que hay contención de bloqueos | Baja al principio |
| **(d) Event sourcing** | Los command handlers del agregado | Versión esperada del stream | Eventos, suscripciones, process managers | Dados estos eventos, cuando este comando, entonces estos eventos | Los streams escalan bien; las lecturas necesitan proyecciones | Alta |
| **(e) Decider** | Funciones puras `decide` y `evolve` | Lo que lo ejecute (una versión de stream, una versión de fila) | Como (d), o como lo haga el host | Funciones puras, sin store | Como su host | Moderada |
| **(f) Actores** | El manejador de mensajes del actor | Un solo escritor por construcción | Mensajes entre actores | Kits de test de actores | Repartido en un clúster | Alta |
| **(g) Solo la base de datos** | Restricciones, triggers, SERIALIZABLE | La base de datos | Una transacción, o ninguna | Tests de SQL | Una base de datos | Baja para reglas simples, alta para las complejas |

### (a) El modo de newt

Un módulo por agregado, una entidad como raíz, una versión por fila, un guard para una
regla sobre varias filas, eventos a través del outbox para todo lo que queda fuera.

- **A favor:** agregados pequeños por defecto; las reglas se comprueban al ejecutar
  (la regla de escritura, la regla del guard) y al compilar (`after` sin `guard`); un
  mismo modelo para todos los stores; consistencia eventual que no pierde eventos; sin
  más infraestructura que la base de datos.
- **En contra:** las reglas de conjunto están en repositorios, no en el modelo de
  dominio; una regla sobre varias filas se escribe dos veces (la comprobación del
  caso de uso y la del guardado); los nombres de bloqueo son cadenas; todo está en una
  base de datos por contexto, así que escalar un solo tipo de agregado significa un
  contexto nuevo.

### (b) Agregados grandes y grafos de objetos con un ORM

JPA e Hibernate con cascadas, Entity Framework Core con propiedades de navegación,
carga perezosa. La raíz contiene a sus hijos como objetos, y guardar la raíz guarda el
grafo:

```java
@Entity
class Board {
  @Version long version;
  @OneToMany(mappedBy = "board", cascade = CascadeType.ALL, orphanRemoval = true)
  List<Column> columns = new ArrayList<>();

  void addColumn(String name) {
    if (columns.size() >= 10) throw new TooManyColumns();
    columns.add(new Column(this, name, columns.size()));
  }
}
```

- **A favor:** la regla está donde el lector la busca, en la raíz; la versión de la
  raíz hace que dos altas choquen (con una colección `mappedBy`, como aquí, Hibernate
  no mueve la versión de la raíz al añadir un hijo: un modo de bloqueo como
  `OPTIMISTIC_FORCE_INCREMENT` sí); herramientas maduras.
- **En contra:** el grafo crece. Navegar de un agregado a otro está a una propiedad de
  distancia, así que las referencias por identidad se erosionan, y una transacción
  acaba cambiando varios. La carga perezosa esconde consultas (el problema N+1) y
  falla fuera de una sesión. Cada cambio en cualquier parte de un agregado grande
  choca con todos los demás. El ensayo de Vernon trata, en buena parte, del dolor de
  este enfoque.

### (c) Transaction scripts y servicios anémicos

El CRUD típico de Express o NestJS: un método de servicio abre una transacción, lee,
comprueba, escribe varias tablas, confirma. Martin Fowler dio nombre a los dos: el
Transaction Script (*Patterns of Enterprise Application Architecture*, 2002) y el
Anemic Domain Model (un artículo de 2003): entidades como bolsas de campos, reglas en
los servicios.

```ts
await db.transaction(async tx => {
  await tx.query('SELECT id FROM board WHERE id = $1 FOR UPDATE', [boardId])
  const [{ count }] = await tx.query('SELECT count(*) FROM column WHERE board_id = $1', [boardId])
  if (count >= 10) throw new TooManyColumns()
  await tx.query('INSERT INTO column …')
})
```

(Bloquear la fila del tablero es lo que hace que el recuento se sostenga, y solo si
todo camino de código que añade una columna la bloquea antes. Contar sin más, incluso
dentro de la transacción, deja que dos peticiones vean nueve las dos. Acertar con eso
en cada método de servicio es justo el problema.)

- **A favor:** poco que aprender; una transacción hace consistente cualquier cambio;
  rápido de escribir en apps sencillas.
- **En contra:** no hay ningún límite, así que las reglas están donde las dejó la
  última persona; una transacción crece hasta bloquear media base de datos; los
  eventos enviados desde dentro de la transacción se pierden o se envían dos veces sin
  un outbox; la concurrencia es correcta solo si cada autor conoce bien los bloqueos
  de la base de datos.

### (d) Agregados con event sourcing

Axon Framework (Java), Eventuous (.NET), EventStoreDB (ahora KurrentDB), Marten. Un
agregado es un stream de eventos. Un comando carga el stream, reconstruye el estado,
decide, y añade eventos nuevos con la versión que leyó como versión esperada; otro
escritor entretanto hace que el añadido falle.

- **A favor:** el límite es el stream, así que las reglas de Vernon son la forma del
  almacenamiento; los eventos son el historial, así que las auditorías y los nuevos
  modelos de lectura salen gratis; la concurrencia es exactamente un número por
  agregado; los tests se leen como "dados estos eventos, cuando este comando, entonces
  estos eventos".
- **En contra:** las lecturas necesitan proyecciones, que son consistentes a la larga;
  la forma de un evento es para siempre, y cambiar una significa hacer upcasting; las
  reglas de conjunto (un nombre único en un workspace) son tan difíciles como en el
  diseño de Vernon, y se resuelven con un stream de reserva o una tabla de consulta;
  más infraestructura y más que aprender. newt mantiene los eventos como avisos de un
  cambio de estado, no como el estado.

### (e) El Decider funcional

Jérémie Chassaing lo describió en *Functional Event Sourcing Decider* (2021): un
agregado son tres cosas puras, un estado inicial, `decide(command, state) → events` y
`evolve(state, event) → state`.

```ts
const decide = (command: AddColumn, board: BoardState): ColumnAdded[] => {
  if (board.columns.length >= 10) throw new TooManyColumns()
  return [{ type: 'ColumnAdded', name: command.name, position: board.columns.length }]
}

const evolve = (board: BoardState, event: ColumnAdded): BoardState =>
  ({ ...board, columns: [...board.columns, event.name] })
```

- **A favor:** las reglas son funciones puras, que se prueban sin nada más; funciona
  sobre event sourcing o sobre un estado guardado (`evolve` plegado una vez, el estado
  guardado con una versión); se compone.
- **En contra:** no dice nada de concurrencia ni de consistencia entre agregados: eso
  lo hace el host. Su agregado sigue siendo un solo límite, así que una regla de
  conjunto necesita el conjunto en el estado. Los equipos que no están acostumbrados
  al estilo funcional lo encuentran abstracto.

La entidad de newt se parece más a su hermana orientada a objetos: un método decide y
cambia el estado a la vez, y el evento dice qué cambió.

### (f) Agregados con el modelo de actores

Los grains de Microsoft Orleans, los actores persistentes de Akka
(`EventSourcedBehavior`, con Cluster Sharding). Cada instancia de agregado es un
actor; los mensajes que recibe se tratan de uno en uno. Dos cambios a un agregado
nunca se ejecutan a la vez, así que no hay nada que pueda chocar.

- **A favor:** un escritor por agregado por construcción, sin reintentos optimistas;
  el estado se queda en memoria, así que los agregados calientes son rápidos; escala
  en un clúster.
- **En contra:** una regla entre agregados es una conversación entre actores, así que
  es eventual por naturaleza; la colocación, la activación, la conmutación por error y
  el plugin de persistencia son infraestructura que tienes que operar; un mensaje
  lento bloquea a su actor; un actor al que llama otro al que él llama se bloquea
  (deadlock) salvo que el framework permita la reentrada.

El guard de newt consigue "un escritor a la vez" para una clave, sin el clúster, y
solo mientras dura el guardado.

### (g) Invariantes solo en la base de datos

Restricciones check, restricciones únicas y de exclusión, claves foráneas, triggers, y
transacciones SERIALIZABLE que hacen que cualquier entrelazado se comporte como uno
detrás de otro.

- **A favor:** nada se les cuela, escriba el programa que escriba; para reglas
  simples (único, no nulo, una clave foránea) nada es más barato ni más seguro.
- **En contra:** una regla como "como máximo diez columnas" es un trigger, en el
  lenguaje de la base de datos, fuera de la vista del código de dominio; el error que
  vuelve es un error de base de datos que hay que traducir; SERIALIZABLE hace fallar
  transacciones bajo contención, que luego deben ejecutarse de nuevo, y es la
  semántica de una base de datos (la de Postgres difiere de la de otras). Las claves
  foráneas atan tablas de agregados distintos, que es el acoplamiento que quita la
  regla 3.

newt usa la base de datos solo para la última palabra: un índice único sobre un valor
que no comparten dos filas, bajo una regla que el código ya comprueba.

## Cuándo elegir qué

- **Una app de newt:** usa el modo de newt. Es lo que comprueba el framework.
- **Un agregado con una regla sobre sus hijos, un número pequeño y fijo de ellos:**
  que la raíz sea dueña de los hijos, como en Vernon, está bien. En newt, guarda los
  hijos como parte de la entidad (un campo lista, guardado como `json`, o filas que
  escribe su propio repositorio) cuando nada fuera necesita apuntarles uno a uno.
- **Hijos a los que otros apuntan, o con vida propia:** un módulo propio, y la regla
  de conjunto en un guardado con guard, como las columnas de cooper.
- **Historial completo como requisito** (finanzas, auditoría): event sourcing, o newt
  con un módulo de movimientos de solo añadir para ese valor
  ([las reglas](../reference/rules#saving) describen las dos formas de un valor que
  muchos cambian a la vez).
- **Agregados únicos muy calientes en muchas máquinas:** actores.
- **Un CRUD pequeño con pocas reglas:** los transaction scripts son más baratos,
  hasta que dejan de serlo.
- **Reglas que una base de datos dice bien** (único, no nulo): siempre también en la
  base de datos.

## Encontrar un límite en una app de newt

Pregunta esto, en orden:

1. **¿Qué regla debe cumplirse después de cada guardado?** Dibuja el límite alrededor
   de los datos que lee. "Como máximo diez columnas" lee las columnas de un tablero:
   ese conjunto es el límite, y `columns:<board>` su nombre.
2. **¿Puede ser cierta un momento después?** Entonces no es un solo límite: la
   segunda parte sigue por un evento. Una tarjeta en una columna quitada va a la
   primera columna un momento después (`leaveRemovedColumn`). Una tarjeta asignada a
   alguien que dejó el workspace pierde a su asignado un momento después
   (`unassignMember`).
3. **¿Algo más le apunta por id?** Entonces es un módulo propio. Las tarjetas apuntan
   a las columnas, así que las columnas no son un campo del tablero.
4. **¿Lo cambian muchas personas a la vez?** Entonces mantenlo aparte de lo que cambia
   pocas veces. El contador de tarjetas es una fila propia, no un campo del tablero
   con el que chocaría cada renombrado.
5. **¿Describirlo necesita una "y"?** Entonces son dos módulos
   ([capítulo 2](./02-first-module)).

Dos señales de que un límite está mal: un caso de uso necesita `writesTo` una y otra
vez para los mismos dos módulos (cambian juntos, así que quizá sean uno), o el
guardado de un módulo protege una clave que protege también el guardado de otro (la
regla abarca a los dos, así que uno de ellos debe ser su dueño).

## Errores comunes

**Dos módulos en un caso de uso.** Un `card.create` que además actualiza el recuento
de tarjetas de un tablero. La regla de escritura lo rechaza fuera de un worker. Haz
la segunda parte desde un worker sobre `card.created`, o, si los dos deben cambiar
siempre juntos, hazlos un solo módulo. Un `writesTo` es para una escritura en otro
módulo, con su motivo al lado, no para una costumbre.

**Leer y luego escribir, sin guard.** Un caso de uso cuenta, decide y guarda:

```ts
if (await this.repo.count({ boardId }) >= MAX_COLUMNS) throw new TooManyColumns(boardId)
await this.repo.persist(column)
```

En SQLite esto parece correcto en todos los tests. En Postgres, dos peticiones cuentan
nueve y las dos guardan. El recuento debe repetirse dentro del guardado, en `after`,
bajo un guard. La comprobación de antes es solo para dar una respuesta clara.

**Llamar a otro módulo desde el hook de un guardado.** Un hook se ejecuta dentro de la
transacción; un caso de uso llamado desde él leería, o escribiría, en esa transacción,
así que dos agregados la compartirían; la regla de escritura rechaza un guardado ahí.
Un hook lee solo las filas de su propio módulo.

**Un evento sin cambio.** Una entidad que anota `card.assigned` cuando la tarjeta ya
tenía ese asignado cuenta algo que no ocurrió. El guardado lo rechaza antes de
escribir nada (`EventWithoutChange`). Cambia aquello de lo que habla el evento a la
vez, o no cuentes nada: el `Card.assign` de cooper vuelve antes de tiempo cuando el
asignado es el mismo.

**Un agregado que crece.** Un tablero que empieza guardando sus columnas, luego sus
tarjetas, luego la actividad de cada tarjeta. Entonces cada cambio choca con todos los
demás, y cargar un tablero lo carga todo. Divídelo con las preguntas 3 y 4 de arriba:
lo que otros señalan, y lo que muchos cambian a la vez, van aparte.

**Una clave de guard más ancha o más estrecha que la regla.** `board:<workspace>` para
la regla del nombre hace que cada guardado de tablero de un workspace espere a todos
los demás. Una clave con el nombre tal como se escribió, no en minúsculas, es
demasiado estrecha: `Roadmap` y `ROADMAP` toman dos claves, se ejecutan en paralelo, y
las dos pasan el recuento. Nombra exactamente lo que lee la regla, en la forma en que
lo compara.

**Un worker que da por cierto el evento.** Un job se ejecuta más tarde, quizá después
de otros cambios, y quizá dos veces. Lee de nuevo aquello de lo que trata antes de
actuar, como `notifyAssignee` lee otra vez la tarjeta, y lo que no puede deshacer
lleva una clave, como el email de `notifyAssignee` lleva el id de su evento, para que
enviado dos veces salga una ([capítulo 12](./12-failures)).

## En resumen

- Un módulo es un agregado; su entidad es la raíz, y solo la entidad se cambia a sí
  misma.
- Un guardado es de un solo módulo, todo o nada; la regla de escritura hace que un
  caso de uso escriba en otro módulo solo desde un worker, o con `writesTo` y su
  motivo, y nunca dos módulos en una transacción, tampoco en un worker.
- Una versión protege una fila; un guard protege una regla sobre varias filas, con un
  nombre tan estrecho como la regla.
- Los demás agregados son ids, comprobados preguntando a su módulo, y seguidos por
  sus eventos y por los tuyos: cada seguidor comprueba el otro lado después de su
  propio commit, así que el que corre el último ve los dos.
- Lo que pasa en otro sitio pasa después, desde el outbox, seguro de repetir.
