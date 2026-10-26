# Transacciones

Mover una columna de un tablero no es una sola escritura. La columna se mueve, y todas
las que hay entre su sitio de antes y el nuevo se desplazan uno. Si el servidor se
parara a mitad, dos columnas compartirían posición y faltaría otra. Este capítulo
enseña cómo newt mantiene juntas varias escrituras, y por qué nunca junta las de más
de un módulo.

## Qué es una transacción

Una transacción es un conjunto de escrituras que ocurren **todas o ninguna**. Si a
mitad algo falla (un error, un corte de luz), no queda nada a medias: es como si no
hubiera empezado.

En newt, **una transacción es un guardado**: cada llamada a `repo.persist(...)`, o al
`save` que hay detrás. Dentro de esa transacción el framework escribe las entidades
**y los trabajos de los workers que despiertan sus eventos**. Las dos cosas quedan
guardadas juntas, o ninguna. Sobre esa garantía se construyen los capítulos
[10](./10-events) a [16](./16-sagas).

## Varias entidades a la vez

`persist` acepta varias entidades **del mismo módulo**, y las guarda en una sola
transacción:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const cards = await this.repo.find({ assigneeId: userId })
for (const card of cards) card.unassign()
await this.repo.persist(...cards)
```

Un repositorio también puede darle al guardado un nombre propio, cuando el guardado
dice algo más. Mover una columna es uno de esos casos. El caso de uso carga las
columnas del tablero, pone la que se mueve en su sitio, le da a cada una su posición
nueva y las guarda todas:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * Moves a column to another place on its board, and the others take the places
 * left: several columns saved at once, all or none. Whoever moved one of them
 * meanwhile makes it run again, from the start, with the board as it is then.
 */
@UseCase()
async move(id: string, input: ColumnMoveDTO): Promise<ColumnDTO> {
  const { position } = ColumnMoveSchema.parse(input)
  const column = await this.load(id)
  const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
  const at = Math.min(position, others.length)
  others.splice(at, 0, column)
  others.forEach((each, index) => each === column ? column.moveTo(index) : each.reposition(index))
  await this.repo.persistOrder(others, column.boardId)
  return column.toDTO()
}
```

La entidad distingue dos clases de cambio. `moveTo` es lo que alguien hizo, y lo cuenta
con un evento; `reposition` es una columna que ocupa el hueco que quedó, y no cuenta
nada:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
/** Someone moved it: where it goes. */
moveTo(position: number): void {
  this.change({ position })
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Column_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}

/** Another one moved, or left: this one takes the place left to it, and tells nothing. */
reposition(position: number): void {
  this.change({ position })
}
```

`persistOrder` escribe todas las columnas que recibe en una transacción:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
async persistOrder(columns: Column[], boardId: string): Promise<void> {
  await this.save(columns, each => this.write(each), {
    guard: [`columns:${boardId}`],
    after: async () => {
      const positions = (await this.ofBoard(boardId)).map(each => each.position)
      if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
    },
  })
}
```

Olvida de momento `guard` y `after`: protegen el orden del guardado de otro, y los
explican los capítulos [7](./07-concurrency) y [8](./08-rules-over-rows). Lo que
importa aquí es `this.save(columns, …)`: todas las columnas, o ninguna.

Mover una tarjeta toca más filas. La tarjeta sale de una columna y entra en otra: las
que estaban debajo en la primera suben, y las que quedan debajo de su sitio nuevo
bajan. Un solo guardado escribe las dos columnas:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async move(id: string, input: CardMoveDTO): Promise<CardDTO> {
  const { columnId, position } = CardMoveSchema.parse(input)
  const card = await this.load(id)
  const from = card.columnId
  if (columnId !== from) await this.assertColumnOf(card.boardId, columnId)
  const left = (await this.repo.inColumn(from)).filter(each => each.id !== id)
  const target = columnId === from ? left : await this.repo.inColumn(columnId)
  const at = Math.min(position ?? target.length, target.length)
  target.splice(at, 0, card)
  if (target !== left) left.forEach((each, index) => each.reposition(index))
  target.forEach((each, index) => each === card ? card.moveTo(columnId, index) : each.reposition(index))
  await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
  return card.toDTO()
}
```

Borrar una tarjeta es el mismo movimiento con una tarjeta de menos: la borrada y las
que suben van en un solo guardado.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** Deletes it, and the cards under it move one place up. Its number is not given again. */
@UseCase()
async delete(id: string): Promise<void> {
  const card = await this.load(id)
  const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
  others.forEach((each, index) => each.reposition(index))
  card.delete()
  await this.repo.persistOrder([card, ...others], [card.columnId])
}
```

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('moves a column, and the others take the places left', async () => {
  const [, , done] = [await add('To do'), await add('Doing'), await add('Done')]

  await inAcme(() => t.modules.column.move(done.id, { position: 0 }))
  expect(await names()).toEqual(['0:Done', '1:To do', '2:Doing'])

  await inAcme(() => t.modules.column.move(done.id, { position: 99 }))
  expect(await names()).toEqual(['0:To do', '1:Doing', '2:Done'])
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('moves a card to another column, or within its own, and the others make room', async () => {
  const [plan, design, build] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.move(design.id, { columnId: doing }))
  await inAcme(() => t.modules.card.move(build.id, { columnId: doing, position: 0 }))
  await inAcme(() => t.modules.card.move(plan.id, { columnId: doing, position: 1 }))
  expect(await columns()).toEqual({ todo: [], doing: ['#3@0', '#1@1', '#2@2'], done: [] })
  // …
})
```

O con cooper en marcha, con la sesión del navegador (la cookie es
`cooper_boards_session`):

```bash
curl -X POST http://localhost:3002/api/workspaces/$WORKSPACE/columns/$COLUMN/move \
  -H 'content-type: application/json' \
  -b "cooper_boards_session=$SESSION" \
  -d '{"position":0}'
```

## Un módulo, una transacción

Un guardado escribe las filas de **un módulo**. Tarjetas y columnas son dos módulos,
así que ningún guardado mueve a la vez una tarjeta y una columna. Lo que tiene que
guardarse junto, todo o nada, es **un agregado**, y un agregado es **un módulo**. Si
dos módulos tuvieran que cambiar siempre a la vez, en realidad serían uno. Si no, uno
sigue al otro mediante eventos.

cooper tiene justo un caso así. Para quitar una columna tiene que estar vacía, pero el
módulo de columnas no sabe nada de tarjetas. Así que `card.removeColumn` pregunta a las
tarjetas, y después le pide al módulo de columnas que la quite. Quitar la columna es
su única escritura, así que un fallo no deja nada a medias:

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

Una tarjeta que entre en esa columna justo en ese momento no se pierde: un worker de
las tarjetas la lleva a la primera columna cuando oye `column.removed` (el capítulo
[17](./17-modules-talk) cuenta esa historia, y por qué hace falta `writesTo`).

## Por qué no una transacción por caso de uso

Podría parecer más sencillo envolver el caso de uso entero en una transacción. newt no
lo hace, por dos motivos:

- **Un caso de uso puede leer de otros módulos**, y cada módulo guarda solo lo suyo.
  Una transacción grande que cruzara módulos los ataría entre sí.
- **Las transacciones cortas no se estorban.** En SQLite solo corre una a la vez, y las
  demás esperan su turno; en Postgres y MySQL corren a la vez, pero bloquean lo que
  tocan. Un caso de uso que leyera, pensara y llamara a otros con la transacción
  abierta haría esperar a todo el mundo. `card.create` lee el tablero y las columnas,
  y le pregunta a auth si el asignado es miembro, antes de abrir su único guardado,
  corto.

La regla práctica: **guarda una vez, al final**.

Cuando un caso de uso no puede evitar guardar en dos pasos, pon primero lo que pueda
fallar, y haz que cada paso se pueda repetir. `tenant.create`, en auth, es uno de
ellos: guarda el espacio de trabajo, y después le da a su creador el acceso de
administrador, un guardado de otro módulo.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * A new workspace, made by the signed-in person, who is its admin. It writes to
 * `access` without being a worker, on purpose: whoever makes a workspace enters it
 * the moment it answers. The workspace is saved first and its admin after; should
 * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it.
 * It never runs again on a conflict: it would make a second workspace.
 */
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  await this.repo.persist(tenant)
  await this.admitAdmin(tenant.toDTO())
  return tenant.toDTO()
}
```

Si falla el segundo guardado, el primero ya escribió en su transacción el trabajo de
`tenant.created`, y el worker da el acceso de administrador. `access.admit` se puede
ejecutar dos veces sin daño: dado dos veces, se da una. El capítulo
[13](./13-repeatable-workers) trata de ese tipo de pasos.

## En resumen

- Una transacción es un guardado: `persist`, o el `save` al que un repositorio le da
  nombre. Todo lo que lleva se escribe, con los trabajos de sus eventos, o nada.
- Un guardado escribe un módulo. Guarda a la vez varias entidades suyas para que queden
  coherentes: mover una columna, mover una tarjeta.
- Un agregado es un módulo. Los módulos que tienen que cambiar juntos son uno; los
  demás se siguen con eventos.
- Guarda una vez, al final. Lee y decide antes, fuera de la transacción.
- Si tienes que guardar dos veces, pon primero lo que pueda fallar, y haz que cada
  paso se pueda repetir.
