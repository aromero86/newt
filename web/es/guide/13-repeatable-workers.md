# Workers que se pueden repetir

El capítulo anterior terminó con una garantía que suena a problema: un job se ejecuta
al menos una vez, así que quizá más. Este capítulo enseña por qué, y cómo están
escritos los workers de cooper para que ejecutarlos dos veces dé el mismo resultado
que ejecutarlos una.

## Por qué un job puede ejecutarse dos veces

Un worker termina su job, y justo antes de marcarlo como hecho, el servidor se para.
Al volver, el job sigue pendiente, y se ejecuta otra vez. No hay forma de evitarlo del
todo: entre hacer algo y apuntar que se hizo siempre hay un instante.

Y hay más caminos para llegar ahí:

- El job falló a mitad, después de escribir parte de lo que escribe. Su reintento
  empieza desde el principio.
- Un worker tiene un job con una concesión (lease) de un minuto, que renueva cada
  veinte segundos mientras trabaja. Si el proceso se congela y la concesión vence,
  otro worker se queda el job, y puede que el primero aún termine.
- Dos eventos distintos llevan al mismo caso de uso. `card.notifyAssignee` se ejecuta
  con `card.created` y con `card.assigned`.

Por eso todo worker debe ser **idempotente**: ejecutarlo dos veces tiene que dar el
mismo resultado que ejecutarlo una. En la práctica, significa que cada caso de uso al
que llama un worker está escrito para repetirse.

## Cuatro técnicas

### 1. Mirar el estado antes de actuar

La más sencilla: antes de hacer algo, mira si ya está hecho. `workspace.prepare` lo
hace en cada uno de sus pasos:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async prepare(workspaceId: string): Promise<void> {
  if (!await this.deps.member.exists(workspaceId)) return
  await runInWorkspace(workspaceId, async () => {
    const board = await this.deps.board.findByName(WELCOME_BOARD.name)
      ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
    const columns = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
    const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
    await this.deps.card.createFirst(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
  })
  if (!await this.deps.member.exists(workspaceId)) await this.purge(workspaceId)
}
```

- El workspace: si auth lo borró entre medias, no hay nada que preparar (el [capítulo
  anterior](./12-eventual-consistency) explica la comprobación del final).
- El tablero: busca uno llamado "Welcome" antes de crearlo.
- Las columnas: `column.addMissing` añade solo las que el tablero no tiene.
- La tarjeta: `card.createFirst` la crea solo si el tablero no tiene ninguna.

Los dos últimos son casos de uso escritos para un worker. Cada uno dice en su nombre
que se puede llamar otra vez, y responde con lo que hay:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * Adds at the end of the board the columns of these names it does not have yet,
 * and answers all its columns: what a worker preparing a board calls, as many
 * times as it takes. Runs at once add each name once: the save checks it again.
 */
@UseCase()
async addMissing(boardId: string, names: string[]): Promise<ColumnDTO[]> {
  await this.deps.board.get(boardId)
  const columns = await this.repo.ofBoard(boardId)
  const missing = names.filter(name => !columns.some(column => column.name === name))
  if (missing.length === 0) return columns.map(column => column.toDTO())
  // …
  await this.repo.persistMissing(added, boardId)
  return [...columns, ...added].map(column => column.toDTO())
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A board's first card, unless it has one already (null then): what a worker
 * preparing a board calls, as many times as it takes. Runs at once create it once:
 * the save counts the board's cards again.
 */
@UseCase()
async createFirst(boardId: string, input: CardCreateDTO): Promise<CardDTO | null> {
  if (await this.repo.count({ boardId }) > 0) return null
  const card = await this.newCard(boardId, input, BOARDS)
  await this.repo.persistNew(card, { first: true })
  return card.toDTO()
}
```

Cada paso es una transacción aparte, así que una ejecución puede pararse entre dos
cualesquiera. La siguiente termina lo que dejó la anterior, y no añade nada a un
workspace ya terminado.

Las entidades se protegen igual. `card.unassign()` sobre una tarjeta sin nadie
asignado no cambia nada ni cuenta nada:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
unassign(author: CardAuthor): void {
  const previousAssigneeId = this.data.assigneeId
  if (previousAssigneeId === null) return
  // …
}
```

Y `unassignMember`, que se ejecuta cuando alguien pierde su acceso a un workspace, se
apoya en eso. La segunda vez, el miembro ya no tiene tarjetas:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Someone lost their access to a workspace: its cards they had are left without an
 * assignee. What a worker calls, reacting to auth; the second time, they have none.
 */
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign(BOARDS)
    await this.repo.persist(...cards)
  })
}
```

### 2. Algo que identifica la operación, comprobado en el guardado

Mirar antes basta cuando las ejecuciones llegan una detrás de otra. Pero dos
ejecuciones a la vez miran las dos antes de que ninguna guarde, y las dos no ven
nada. La comprobación de verdad tiene que ir dentro del guardado.

Para el tablero de bienvenida, lo que identifica la operación es el nombre del
tablero. Un workspace no puede tener dos tableros con el mismo nombre, y esa regla se
comprueba dentro del guardado, con un guard sobre el nombre ([reglas sobre
filas](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
async persistWithNameFree(board: Board): Promise<void> {
  const { workspaceId, name } = board
  await this.save([board], each => this.write(each), {
    guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
    after: async () => {
      if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
    },
  })
}
```

Dos ejecuciones de `prepare` a la vez no pueden crear las dos "Welcome". La segunda
espera a la primera, ve su tablero y falla con `BoardNameTaken`. Su job se ejecuta
otra vez más tarde, encuentra el tablero y sigue desde ahí. La comprobación del paso
1 se queda como atajo: una repetición que llega sola ni siquiera intenta guardar.

Las columnas y la primera tarjeta hacen lo mismo, con un final más suave. Sus
guardados vuelven a contar bajo el guard del tablero, y el que encuentra el trabajo
de otra ejecución lanza `ConcurrencyConflict`, así que su caso de uso se ejecuta otra
vez en el acto y encuentra lo que hay:

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
      if (options.first && count > 1) throw new ConcurrencyConflict()
    },
  })
}
```

auth da un acceso de la misma forma, así que `tenant.ensureAdmin` puede ejecutarse
mientras la petición que creó el workspace todavía lo está dando. El guardado lleva
un guard con la clave del acceso, y la tabla tiene un índice único sobre ella. El que
pierde responde con el acceso que dio el otro:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
  const { userId, productId, tenantId } = input
  const existing = await this.repo.first({ userId, productId, tenantId })
  if (existing) return existing.toDTO()
  const access = Access.grant(input)
  try {
    await this.repo.persistKeepingOneAdmin(access)
  } catch (error) {
    // Given by another save at the same time (a tenant's admin, by the request that
    // made it and by its worker): given once, and this one gives what is there.
    const given = error instanceof ConcurrencyConflict ? await this.repo.first({ userId, productId, tenantId }) : undefined
    if (!given) throw error
    return given.toDTO()
  }
  return access.toDTO()
}
```

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
await this.save(accesses, access => this.write(access), {
  guard: [
    ...accesses.map(access => `access:${access.userId}:${access.productId}:${access.tenantId ?? ''}`),
    ...tenants.map(tenantId => `tenantAdmin:${tenantId}`),
  ],
  // …
})
```

### 3. El id del evento como id del resultado

A veces nada en los datos identifica la operación. El registro de actividad de una
tarjeta apunta "Ana movió la #4 a Done". Ana puede moverla ahí dos veces, y los dos
movimientos tienen que estar en el registro: buscar "una entrada sobre mover la #4 a
Done" se comería el segundo.

Lo que identifica cada entrada es el evento que apunta. Cualquier evento de una
tarjeta lleva un `eventId` ([eventos](./10-events)), y la entrada lo toma como su
propio id:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
/**
 * Records an event of a card, in its workspace (a worker is in none), by the event's
 * id: the second time, the entry is there already.
 */
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

Un job que se ejecuta dos veces encuentra su entrada y para. Dos ejecuciones a la vez
intentan insertar las dos el mismo id, y la clave primaria rechaza la segunda. Dos
movimientos son dos eventos, con dos ids: dos entradas. Cada vez que un worker crea
algo, pregúntate qué id debería tener; muchas veces la respuesta es el id del evento.

### 4. Escribir el resultado, no el cambio

"Deja la tarjeta sin nadie asignado" se puede repetir. "Cambia la persona asignada"
no. Cuando un worker cambia datos, haz que escriba el estado que quiere, no un paso a
partir del estado que encontró.

`workspace.purge`, el paso del borrado de un workspace que corre en boards, está
escrito así. No borra "los tableros que leyó"; borra "todos los tableros de este
workspace", haya los que haya:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
async purgeWorkspace(workspaceId: string): Promise<void> {
  await this.saveRows(async () => {
    await this.base.db.deleteFrom('board').where('workspaceId', '=', workspaceId).execute()
  })
}
```

La segunda vez no hay nada que borrar, y nada falla.

## Cuando se ejecuta tarde

Ser idempotente no basta. Un job también puede ejecutarse tarde, cuando los datos ya
han vuelto a cambiar. `notifyAssignee` recibe la tarjeta como estaba al asignarla.
Cuando corre el worker, puede que alguien la haya desasignado, o se la haya dado a
otra persona. Así que vuelve a leer la tarjeta:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async notifyAssignee(card: CardDTO, by: string | null): Promise<void> {
  if (card.assigneeId === null || card.assigneeId === by) return
  const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
  if (current?.assigneeId !== card.assigneeId) return
  const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
  if (!member) return
  // …
}
```

- La tarjeta ya no existe: no hay email.
- Ahora la tiene otra persona: no hay email. Esa asignación contó su propio evento, y
  su job avisa a quien la tiene ahora.
- La persona asignada ha dejado el workspace: no hay email.

`prepare` se hace la misma clase de pregunta con `member.exists`: ¿sigue ahí el
workspace? El evento dice lo que pasó. Lo que es cierto ahora, el worker lo vuelve a
leer.

## Lista de comprobación

Antes de dar por bueno un worker, pregúntate:

- [ ] Si se ejecuta dos veces seguidas, ¿el resultado es el mismo?
- [ ] Si dos ejecuciones se solapan, ¿una comprobación dentro del guardado para a la
  segunda?
- [ ] Si se ejecuta tarde, cuando los datos ya cambiaron, ¿hace algo sensato?
- [ ] Si falla a mitad, ¿el reintento termina el trabajo?
- [ ] ¿Distingue un "no" de negocio (nada que hacer: return) de un fallo (throw, y se
  repite)? De esta va [cuando algo falla](./15-failures).

## Compruébalo

Los tests de cooper hacen cada pregunta a propósito. Este prepara
una ejecución de `prepare` que se quedó a medias (un tablero y una columna, a mano),
y después ejecuta el job dos veces:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board and one column.
  const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
  await inAcme(() => t.modules.column.add(board.id, { name: 'To do' }))

  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()
  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

Un tablero (el que había, encontrado por su nombre sin importar mayúsculas), tres
columnas, una tarjeta. La segunda pregunta, con tres ejecuciones a la vez sobre un
tablero que se quedó sin columnas:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('gives the welcome board its columns and its card once, however many runs go at once', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board, and none of its columns.
  await inAcme(() => t.modules.board.create({ name: 'Welcome' }))

  await Promise.all([t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana')])
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['Welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
  expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done'])
})
```

La tercera: el trabajo de `tenant.created`, ejecutado otra vez tarde, cuando el
workspace ya se borró y se purgó, no escribe nada:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares nothing in a workspace auth deleted before its work ran', async () => {
  await t.auth.createWorkspace('acme', 'ana')
  await t.auth.deleteWorkspace('acme')
  await t.settled()

  // The work of `tenant.created`, run again late: after the workspace was purged.
  await t.auth.tellCreatedAgain('acme')
  await t.settled()

  expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
  expect(await t.modules.card.countByWorkspace(['acme'])).toEqual([{ workspaceId: 'acme', cards: 0 }])
})
```

Y el registro de actividad, llamado dos veces con el mismo evento, lo apunta una:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
test('records each event once, however many times its job runs', async () => {
  const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
  await t.settled()
  const told = { ...card, by: 'ana', via: 'web' as const, eventId: Bun.randomUUIDv7(), at: new Date().toISOString() }

  await t.modules.activity.recordCreated(told)
  await t.modules.activity.recordCreated(told)

  expect((await activityOf(card.id)).total).toBe(2)
})
```

Dos entradas: el `card.created` de la propia tarjeta, que apuntó su worker, y el que
el test contó dos veces.

## En resumen

- Un job se ejecuta al menos una vez, así que quizá dos: todo worker debe ser
  idempotente.
- Mira el estado antes de actuar: busca antes de crear, añade solo lo que falta.
- Cuando dos ejecuciones pueden solaparse, la comprobación de verdad va dentro del
  guardado, con un guard.
- Si nada en los datos identifica el trabajo, usa el id del evento como id del
  resultado.
- Escribe el resultado, no el cambio.
- Un job que llega tarde vuelve a leer los datos: el evento dice lo que pasó, no lo
  que es cierto ahora.
- Pruébalo: ejecuta el trabajo dos veces, y desde un estado a medias.
