# Valores que todos cambian a la vez

Cada tarjeta de un tablero tiene un número: #1, #2, #3… La gente dice "la #12 está
bloqueada", el email de asignación la nombra así, y `card.getByNumber` encuentra una
tarjeta por él. Dos personas que crean tarjetas en el mismo tablero en el mismo
momento tienen que recibir dos números distintos. Y un número no puede volver nunca:
si se borra la #12, la "#12" del email de la semana pasada no puede acabar siendo otra
tarjeta.

El siguiente número de un tablero es un valor que **todos cambian a la vez**: cada
tarjeta nueva del tablero lo coge y lo sube en uno. Este capítulo enseña dónde lo
guarda cooper, cómo dos tarjetas creadas a la vez se turnan para cogerlo en lugar de
chocar, y qué hacer cuando turnarse no basta.

## Dos diseños que no funcionan

**Un contador en el tablero.** `nextCardNumber`, un campo del tablero que cada tarjeta
nueva lee e incrementa. Dos problemas:

- La fila del tablero chocaría con cualquier otra cosa que la guarde. Renombrar el
  tablero mientras se crean tarjetas convertiría uno de los dos guardados en un
  `ConcurrencyConflict`, y se repetiría (capítulo [7](./07-concurrency)).
- El tablero es otro módulo. Crear una tarjeta escribiría dos módulos en un caso de
  uso, y el guardado de un módulo nunca escribe los de otro (capítulo
  [6](./06-transactions)).

**Ningún contador: el número de la última tarjeta, más uno.** Nada con lo que chocar,
y nada escrito fuera de las tarjetas. Pero solo ve las tarjetas que siguen ahí. Las
tarjetas se borran de verdad: borra la #3 de tres, y la siguiente tarjeta vuelve a ser
la #3. El número que no podía volver, vuelve.

## El contador propio de las tarjetas

cooper guarda el último número que dio cada tablero en una tabla del **módulo de
tarjetas**, no del tablero: `card_counter`, una fila por tablero, con el id del
tablero como id propio.

```sql
-- cooper/backend/contexts/boards/migrations/00003_card_counter_up.sql
-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's. A board that has cards starts from its highest number.
CREATE TABLE card_counter (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);

INSERT INTO card_counter (id, workspace_id, last_number, version)
SELECT board_id, workspace_id, max(number), 1 FROM card GROUP BY board_id, workspace_id;
```

La última línea importa cuando añades una tabla así a una aplicación que ya está en
marcha: los tableros que tienen tarjetas empiezan desde su número más alto, no desde
1. De las migraciones trata el capítulo [24](./24-migrations).

La tabla no tiene entidad propia. Es parte de cómo el repositorio de tarjetas guarda
una tarjeta, así que el repositorio la abre junto a su propia tabla:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The last number a board gave a card: its id is the board's. A card deleted does not give it back. */
export type CardCounterRow = { id: string, workspaceId: string, lastNumber: number, version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  private readonly counters

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
    this.counters = base.store.table<CardCounterRow>('card_counter')
  }
  // …
}
```

Crear una tarjeta escribe solo filas del módulo de tarjetas, y la fila del tablero no
se toca: renombrar un tablero y crear sus tarjetas nunca chocan.

## Coger el número en el guardado

El contador es una fila que actualiza cada tarjeta nueva del tablero. Dos tarjetas
creadas a la vez leerían las dos `lastNumber: 6`, e intentarían escribir 7: una de las
dos chocaría con la versión de la fila, y se repetiría. Con diez personas en un
tablero, los reintentos se acumulan.

Así que el número no se coge en el caso de uso. Se coge **dentro del guardado**, en
`before`, con un `guard` sobre el tablero (capítulo [8](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves a new card with the next number of its board and at the bottom of its
 * column, both read inside the save, and only if the board is left with no more
 * than `MAX_CARDS`. The save guards the board's cards and the column's order: two
 * cards created at once in a board get #7 and #8, in any store, and neither waits
 * for a conflict to try again.
 *
 * The number is a value everyone changes at once: each board keeps the last one it
 * gave in a row of its own, which every new card of the board updates. Updated in
 * place, those saves would collide with each other; under the board's guard, they
 * take turns instead, and none is refused. The row is never lowered, so a deleted
 * card's number, even the last one's, is not given again. The table's unique index
 * on (board, number) is the last word.
 */
async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
  const { boardId, columnId } = card
  await this.save([card], each => this.write(each), {
    guard: [`boardCards:${boardId}`, `cards:${columnId}`],
    before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
    after: async () => {
      const count = await this.count({ boardId })
      if (count > MAX_CARDS) throw new TooManyCards(boardId)
      // Its board's first, and another one got in first: the use case runs again, and finds it.
      if (options.first && count > 1) throw new ConcurrencyConflict()
    },
  })
}
```

`takeNumber` lee el contador y lo sube en uno, en la misma transacción que la
tarjeta. La primera tarjeta de un tablero crea la fila:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The board's next number, taken: its counter one up, in the save of the card that gets it. */
private async takeNumber(card: Card): Promise<number> {
  const [counter] = await this.counters.find({ id: card.boardId })
  if (!counter) {
    await this.counters.insert({ id: card.boardId, workspaceId: card.workspaceId, lastNumber: 1 })
    return 1
  }
  const number = counter.lastNumber + 1
  await this.counters.update(counter.id, counter.version, { lastNumber: number })
  return number
}
```

La clave `boardCards:<id del tablero>` es lo que convierte el choque en una cola: dos
guardados con ella nunca se entrelazan, en ningún store. El segundo empieza cuando el
primero ha confirmado, lee `lastNumber: 7`, y escribe 8. Ninguno se rechaza, y ninguno
se repite. La misma clave protege el límite de 500 tarjetas en el `after`, una regla
sobre las tarjetas del tablero (capítulo [8](./08-rules-over-rows)).

La entidad recibe su número y su sitio al guardarse, y el evento que cuenta los dice:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/**
 * A new one takes its number and its place as it is saved: the next number of its
 * board and the bottom of its column, read where no other card can take them in
 * between. What it tells says them.
 */
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created({ ...this.toDTO(), ...this.author! }))
}
```

`trackEvent` sustituye el `card.created` que `Card.create` anotó con el número
supuesto: una entidad cuenta un evento de cada clase por guardado (capítulo
[10](./10-events)).

El caso de uso sigue leyendo antes los dos valores, sin coger nada, para que la
tarjeta que construye sea válida desde el principio:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The number the next card of a board gets: one more than the last one it gave. */
async nextNumber(boardId: string): Promise<number> {
  const [counter] = await this.counters.find({ id: boardId })
  return (counter?.lastNumber ?? 0) + 1
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
return Card.create({
  workspaceId: board.workspaceId,
  boardId,
  columnId,
  // What they look to be now; the save reads them again, where nothing slips in.
  number: await this.repo.nextNumber(boardId),
  position: await this.repo.count({ columnId }),
  title,
  description,
  assigneeId,
}, author)
```

Y la tabla tiene la última palabra, por si algún guardado olvidara su guard:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
```

Los contadores viven y mueren con las tarjetas: cuando auth borra un espacio de
trabajo, el repositorio de tarjetas quita a la vez sus tarjetas y sus contadores
(capítulo [16](./16-sagas)).

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))

  // The last one deleted, its number stays taken: five more at once get #21 to #25.
  await inAcme(() => t.modules.card.delete(created.find(card => card.number === 20)!.id))
  const more = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`More ${i}`)))
  expect(sorted(more.map(card => card.number))).toEqual([21, 22, 23, 24, 25])
})
```

Veinte tarjetas creadas a la vez: números del #1 al #20, posiciones del 0 al 19, ni
repetidos ni saltados. Después se borra la #20, y las cinco siguientes reciben del #21
al #25: el contador nunca baja.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('never gives the number of the last card again, once it is deleted', async () => {
  const [, , build] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.delete(build.id))
  await create('Ship')

  expect(await columns()).toEqual({ todo: ['#1@0', '#2@1', '#4@2'], doing: [], done: [] })
})
```

## La posición de la tarjeta

El sitio de una tarjeta en su columna es el otro valor que todos cambian. Una tarjeta
nueva va al fondo: su posición es cuántas tarjetas tiene la columna. Ese recuento se lee
en el mismo `before`, con el guard `cards:<id de la columna>`, así que dos tarjetas
creadas a la vez en una columna reciben 0 y 1, nunca 0 y 0.

Las posiciones son densas: 0, 1, 2… sin huecos. Es fácil de leer y de comprobar
(`persistOrder` lo comprueba después de cada movimiento, capítulo
[7](./07-concurrency)), y tiene un coste: mover una tarjeta reescribe la posición de
todas las que adelanta. Son escrituras sobre filas que otros también pueden estar
moviendo, protegidas por sus versiones y por el guard de cada columna. Un conflicto
repite el movimiento, y eso vale para columnas de decenas de tarjetas, movidas a la
velocidad de una mano.

La misma clave `cards:<id de la columna>` protege crear, mover y borrar. Así que una
tarjeta nueva y un movimiento en la misma columna nunca se entrelazan: el movimiento ve
la tarjeta nueva, o la tarjeta se crea después del movimiento, en el nuevo fondo.

## Cuando turnarse no basta: añade filas

Turnarse funciona porque un tablero recibe unas pocas tarjetas nuevas por minuto. Un
valor que se escribiera miles de veces por segundo se pasaría el tiempo esperando a su
clave. Para eso está el otro diseño: **no actualices ninguna fila; añade una**. Añadir
una fila nunca choca con otra que se añade: son filas distintas. Lo que necesites saber
se calcula a partir de ellas, o lo guarda quien las lee.

El ejemplo de cooper es la **actividad** de una tarjeta: qué le ha pasado, quién lo
hizo y por dónde entró (capítulo [5](./05-who-and-where)). Es un registro que solo
crece, una entrada por cada evento que cuenta una tarjeta, escrita por un worker que
reacciona a él (capítulo [11](./11-reacting)). Una entrada se registra una vez y no
cambia nunca, y no cuenta nada por sí misma: es lo que contaron los eventos de la
tarjeta.

```ts
// cooper/backend/contexts/boards/modules/activity/activity.ts
export class Activity extends Entity<typeof ActivitySchema> {
  // …
  /** A new entry, by the id of the event it records. */
  static record(input: EntityInput<ActivityDTO> & { id: string }): Activity {
    return new Activity(input, true)
  }
}
```

No hay `edit`, ni `delete`: una tarjeta editada dos veces tiene dos entradas. Dos
personas que mueven tarjetas del mismo tablero a la vez escriben dos filas nuevas, y
ninguna espera a la otra. No hay guard, y no hace falta: ninguna regla habla de varias
entradas.

```sql
-- cooper/backend/contexts/boards/migrations/00004_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  -- …
  version INTEGER NOT NULL
);
```

Cada entrada toma el id del evento que registra. Un worker puede ejecutarse dos veces
(capítulo [13](./13-repeatable-workers)); la segunda, la entrada ya está:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
private async append(card: CardDTO, told: CardAuthor & CardEventStamp, kind: ActivityKind, detail: ActivityDTO['detail']): Promise<void> {
  const { eventId, at, by, via } = told
  await runInWorkspace(card.workspaceId, async () => {
    if (await this.repo.first({ id: eventId })) return
    await this.repo.persist(Activity.record({
      id: eventId,
      // …
    }))
  })
}
```

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
test('records what happens to a card, who did it and how they came in, the newest first', async () => {
  const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
  await inAcme(() => t.modules.card.edit(card.id, { title: 'Plan it' }))
  await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')
  await inAcme(() => t.modules.card.assign(card.id, { assigneeId: 'bea' }))
  await inAcme(() => t.modules.card.unassign(card.id))
  await inAcme(() => t.modules.card.delete(card.id))
  await t.settled()

  const { items, total } = await activityOf(card.id)
  expect(total).toBe(6)
  // …
})
```

Un stock, un saldo o un recuento de votos funcionan igual: una fila por movimiento, y
el valor es su suma. Cuando la suma se lee mucho más de lo que se escribe, guárdala
también, en una fila que actualiza un worker que lee los movimientos, y recuerda que
la verdad son los movimientos.

## En resumen

- Un valor que todos cambian a la vez (un contador, un stock, un saldo) choca consigo
  mismo si cada cambio actualiza una fila en un caso de uso.
- Guárdalo en el módulo que lo cambia, nunca en una fila que escriben también otros
  guardados: los números de tarjeta viven en el `card_counter` de las tarjetas, no en
  el tablero.
- Cógelo dentro del guardado, en `before`, con un `guard` sobre lo que cuenta. Los
  guardados se turnan en lugar de chocar y repetirse.
- Si el valor no puede volver nunca, guárdalo en una fila que solo crece, no lo saques
  de filas que se pueden borrar.
- Deja un índice único como última palabra.
- Cuando ni turnarse es bastante rápido, añade filas en lugar de actualizar una: un
  registro que solo crece, cada fila con el id de lo que registra.
