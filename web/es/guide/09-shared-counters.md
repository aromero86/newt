# Valores que todos cambian a la vez

Cada tarjeta de un tablero tiene un número: #1, #2, #3… La gente dice "la #12 está
bloqueada", el email de asignación la nombra así, y `card.getByNumber` encuentra una
tarjeta por él. Dos personas que crean tarjetas en el mismo tablero en el mismo
momento tienen que recibir dos números distintos, sin saltarse ninguno.

Lo primero que se le ocurre a cualquiera es un contador en el tablero:
`nextCardNumber`, que cada tarjeta nueva lee e incrementa. Este capítulo enseña por qué
es una trampa, y qué hace cooper en su lugar.

## Un valor que choca consigo mismo

Un contador es un valor que **todos cambian a la vez**. Cada tarjeta nueva leería el
tablero, sumaría uno y guardaría el tablero. Dos tarjetas creadas en el mismo momento
guardarían las dos la misma fila del tablero: una recibe un `ConcurrencyConflict`, y se
repite (capítulo [7](./07-concurrency)). Con diez personas trabajando en un tablero,
los reintentos se acumulan. Y la fila del tablero chocaría además con cualquier otra
cosa que la guarde: renombrar el tablero mientras se crean tarjetas.

Hay un segundo problema. El contador vive en el tablero, y la tarjeta es otro módulo.
Crear una tarjeta escribiría dos módulos en un caso de uso, y el guardado de un módulo
nunca escribe los de otro (capítulo [6](./06-transactions)).

La salida es **no guardar el valor**, y sacarlo de filas que solo se **añaden**:

- añadir una fila nunca choca con otra que se añade: son filas distintas;
- el valor se calcula a partir de esas filas, cuando hace falta.

## El número de la tarjeta: el último, más uno

El número de una tarjeta es el que ya tienen las tarjetas de su tablero, más uno:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The number the next card of a board gets: one more than the last one's. */
async nextNumber(boardId: string): Promise<number> {
  const [last] = await this.find({ boardId }, { orderBy: [{ field: 'number', direction: 'desc' }], limit: 1 })
  return (last?.toDTO().number ?? 0) + 1
}
```

Ninguna fila guarda un contador. El tablero no se escribe nunca al crear una tarjeta.

Leído en el caso de uso, eso sí, ese número es solo una suposición: dos tarjetas
creadas a la vez leerían las dos #7. Así que el guardado lo vuelve a leer **dentro de su
transacción**, protegiendo los números del tablero, y le da a la tarjeta el número que
le toca de verdad:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves a new card with the next number of its board and at the bottom of its
 * column, both read inside the save, guarding the board's numbers and the column's
 * order: two cards created at once in a board get #7 and #8, in any store, and
 * neither waits for a conflict to try again.
 *
 * The number is a value everyone changes at once (ch. 11), so no row keeps a counter
 * that every new card would update, and collide on: a card's number is what its
 * board's cards already have, plus one, and the cards are only ever added. The
 * table's unique index on (board, number) is the last word.
 */
async persistNew(card: Card): Promise<void> {
  const { boardId, columnId } = card
  await this.save([card], each => this.write(each), {
    guard: [`cardNumbers:${boardId}`, `cards:${columnId}`],
    before: async () => card.place(await this.nextNumber(boardId), await this.count({ columnId })),
  })
}
```

Esto es `guard` con `before` y sin `after` (capítulo [8](./08-rules-over-rows)). No hay
ninguna regla que comprobar después de escribir: lo que importa es que **leer el último
número y escribir el siguiente** ocurra sin ningún otro guardado de los números del
tablero en medio. Dos tarjetas creadas a la vez se turnan, y ninguna espera a un
conflicto para volver a intentarlo.

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
  this.trackEvent(new Card_Created(this.toDTO()))
}
```

`trackEvent` sustituye el `card.created` que `Card.create` apuntó con el número
supuesto: una entidad cuenta un evento de cada clase por guardado (capítulo
[10](./10-events)).

El caso de uso sigue leyendo antes los dos valores, para que la tarjeta que construye
sea válida desde el principio:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const card = Card.create({
  workspaceId: board.workspaceId,
  boardId,
  columnId,
  // What they look to be now; the save reads them again, where nothing slips in.
  number: await this.repo.nextNumber(boardId),
  position: await this.repo.count({ columnId }),
  title,
  description,
  assigneeId,
})
await this.repo.persistNew(card)
```

Y la tabla tiene la última palabra, por si un guardado se olvidara alguna vez de su
guard:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
```

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
})
```

Veinte tarjetas creadas a la vez: números del #1 al #20, posiciones del 0 al 19, ninguno
repetido, ninguno saltado.

Una tarjeta borrada deja un hueco en los números, y la siguiente no lo ocupa:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
  const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.delete(second.id))
  await create('Ship')

  expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
})
```

::: warning Cuidado
"El último, más uno" solo ve las tarjetas que siguen ahí. Al borrar una tarjeta se
borra su fila, así que si la borrada era la **última** (la #3 de tres), la siguiente
vuelve a recibir el #3. Si un número no debe volver nunca, las filas de las que sale
tienen que quedarse: cuenta también las tarjetas borradas (guárdalas, marcadas como
borradas), o guarda el número más alto dado en una fila que solo crece.
:::

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
velocidad de una mano. Un valor que se escribiera miles de veces por segundo
necesitaría el otro diseño: añadir filas, no reescribirlas nunca.

La misma clave `cards:<id de la columna>` protege crear, mover y borrar. Así que una
tarjeta nueva y un movimiento en la misma columna nunca se entrelazan: el movimiento ve
la tarjeta nueva, o la tarjeta se crea después del movimiento, en el nuevo fondo.

## En resumen

- Un valor que todos cambian a la vez (un contador, un stock, un saldo) choca consigo
  mismo si se guarda en una fila.
- No lo guardes: sácalo de filas que solo se añaden. Dos inserciones nunca chocan.
- Lee lo que necesita la fila nueva (el siguiente número, el fondo de la columna) dentro
  del guardado, en `before`, con un `guard` para ello. Se turnan en lugar de
  reintentar.
- Deja un índice único como última palabra.
- Un valor que sale de unas filas dura lo que duran esas filas: si se pueden borrar,
  decide si el valor puede volver.
