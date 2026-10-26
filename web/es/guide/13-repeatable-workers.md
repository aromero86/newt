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

## Tres técnicas

### 1. Mirar el estado antes de actuar

La más sencilla: antes de hacer algo, mira si ya está hecho. `workspace.prepare` lo
hace en cada uno de sus pasos:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async prepare(workspaceId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const board = await this.deps.board.findByName(WELCOME_BOARD.name)
      ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
    const columns = await this.deps.column.list(board.id)
    for (const name of WELCOME_BOARD.columns) {
      if (!columns.some(column => column.name === name)) columns.push(await this.deps.column.add(board.id, { name }))
    }
    if ((await this.deps.card.listInBoard(board.id)).length > 0) return
    const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
    await this.deps.card.create(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
  })
}
```

- El tablero: busca uno llamado "Welcome" antes de crearlo.
- Las columnas: añade solo las que faltan.
- La tarjeta: si el tablero tiene alguna, no hay nada que añadir.

Cada paso es una transacción aparte, así que una ejecución puede pararse entre dos
cualesquiera. Cualquier ejecución posterior termina lo que dejó la anterior, y no
añade nada a un workspace ya terminado.

Las entidades se protegen igual. `card.unassign()` sobre una tarjeta sin nadie
asignado no cambia nada ni cuenta nada:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
unassign(): void {
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
    for (const card of cards) card.unassign()
    await this.repo.persist(...cards)
  })
}
```

auth hace lo mismo al dar un acceso, así que `tenant.ensureAdmin` puede ejecutarse
después de que la petición ya lo diera:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
  const { userId, productId, tenantId } = input
  const existing = await this.repo.first({ userId, productId, tenantId })
  if (existing) return existing.toDTO()
  const access = Access.grant(input)
  await this.repo.persistKeepingOneAdmin(access)
  return access.toDTO()
}
```

### 2. Algo que identifica la operación, comprobado en el guardado

Mirar primero basta cuando las ejecuciones van una detrás de otra. Pero dos a la vez
miran las dos antes de que ninguna guarde, y ninguna ve nada. La comprobación de
verdad tiene que ir dentro del guardado.

En el tablero de bienvenida, lo que identifica la operación es el nombre del tablero.
Un workspace no puede tener dos tableros con el mismo nombre, y esa regla se comprueba
dentro del guardado, protegiendo el nombre con un guard ([reglas que abarcan varias
filas](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
async persistWithNameFree(board: Board): Promise<void> {
  const { workspaceId, name } = board
  await this.save([board], each => this.write(each), {
    guard: [`boardName:${workspaceId}:${name.toLowerCase()}`],
    after: async () => {
      if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
    },
  })
}
```

Dos ejecuciones de `prepare` a la vez no pueden crear las dos "Welcome". La segunda
espera a la primera, ve su tablero y falla con `BoardNameTaken`. Su job se repite más
tarde, encuentra el tablero y sigue desde ahí. La comprobación de la técnica 1 se
queda como atajo: una repetición que llega sola ni siquiera intenta guardar.

Con el admin de un workspace pasa lo mismo: `persistKeepingOneAdmin` protege el admin
del tenant, así que dos guardados de un admin a la vez no pueden salir bien los dos.

### 3. Escribir el resultado, no el cambio

"Deja la tarjeta sin asignar" se puede repetir. "Cambia la asignación" no. Cuando un
worker cambia datos, haz que escriba el estado que quiere, no un paso desde el estado
que encontró.

`workspace.purge`, el paso del borrado de un workspace que se ejecuta en boards, está
escrito así. No borra "los tableros que leyó"; borra "todos los tableros de este
workspace", haya lo que haya:

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
/**
 * Tells the assignee of a card they have it, by email: from a worker, once the
 * assignment is saved, since an email cannot be taken back (ch. 16). Run late, it
 * reads the card again: if it is gone, or has another assignee by then, there is
 * nothing to tell (that assignment tells its own).
 */
@UseCase()
async notifyAssignee(card: CardDTO): Promise<void> {
  if (card.assigneeId === null) return
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

El evento dice lo que pasó. Lo que es cierto ahora, el worker lo vuelve a leer.

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

Los tests de cooper hacen a propósito la primera y la cuarta pregunta. Este prepara
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
columnas, una tarjeta. Y este comprueba que una tarjeta asignada y desasignada antes
de que corra su worker no avisa a nadie:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
  await create('Plan', { assigneeId: 'bea' })
  const design = await create('Design')
  await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
  await inAcme(() => t.modules.card.unassign(design.id))

  await t.settled()

  expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
})
```

## En resumen

- Un job se ejecuta al menos una vez, así que quizá dos: todo worker debe ser
  idempotente.
- Mira el estado antes de actuar: busca antes de crear, añade solo lo que falta.
- Cuando dos ejecuciones pueden solaparse, la comprobación de verdad va dentro del
  guardado, con un guard.
- Escribe el resultado, no el cambio.
- Un job que llega tarde vuelve a leer los datos: el evento dice lo que pasó, no lo
  que es cierto ahora.
- Pruébalo: ejecuta el trabajo dos veces, y desde un estado a medias.
