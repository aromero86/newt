# Referencias entre módulos

Una tarjeta está en una columna, y puede estar asignada a alguien. La columna es un
módulo de boards. La persona es un usuario de auth, otro contexto. ¿Cómo los guarda
la tarjeta?

## Por su id, y nada más

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  /** Its status: the column it is in, by id. The column is another module's. */
  columnId: z.string(),
  // …
  /** Who it is assigned to: a member of the workspace, by their user's id in auth. */
  assigneeId: z.string().nullable(),
  // …
})
```

Nunca la entidad `Column` dentro de la tarjeta. Nunca un campo que copie el nombre
de la persona asignada. Nunca un JOIN a la tabla de otro módulo. Un agregado apunta a
otro **por su identidad**. Cada módulo sigue siendo dueño de sus datos, y puede
cambiar cómo los guarda sin que nadie se entere.

Esto deja tres preguntas: cómo saber que la referencia existe al guardar, qué pasa
cuando lo otro desaparece, y cómo enseñar su nombre.

## Al escribir: comprobar que existe

Toda tarjeta nueva, la haga `create` para una persona o `createFirst` para el tablero
de bienvenida, pasa por `newCard`, que comprueba las dos referencias. Son
**lecturas**, así que el módulo de tarjetas puede hacerlas desde donde sea:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** A new card of a board, checked: its column is the board's, its assignee a member. */
private async newCard(boardId: string, input: CardCreateDTO, author: CardAuthor): Promise<Card> {
  const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
  const board = await this.deps.board.get(boardId)
  await this.assertColumnOf(boardId, columnId)
  if (assigneeId !== null) await this.assertMember(assigneeId)
  // …
}

/** The column a card goes to is one of its board's: asked to the column module, a read. */
private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
  const columns = await this.deps.column.list(boardId)
  if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
}

/** The assignee belongs to the workspace now: asked to auth, through the member module, every time. */
private async assertMember(userId: string): Promise<void> {
  if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
}
```

La columna se comprueba con el módulo que es su dueño. La persona asignada se
comprueba con auth, en dos pasos:

1. `member.isMember` pregunta al puerto `Workspaces`, por el espacio actual.
2. El puerto, conectado al abrir los contextos, pregunta a `access.check` de auth.

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
/** Whether someone belongs to the current workspace. */
@UseCase()
async isMember(userId: string): Promise<boolean> {
  return this.deps.workspaces.isMember(currentWorkspaceId(), userId)
}
```

```ts
// cooper/backend/open-contexts.ts
isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
```

Se pregunta **cada vez**: nunca se guarda en la tarjeta ni en el actor. A alguien a
quien sacaron del espacio hace un segundo ya no se le puede asignar una tarjeta.

Una referencia que no existe es un error de la petición. Los dos errores son
`ValidationError`, un 400:

```ts
// cooper/backend/contexts/boards/modules/card/errors/assignee-not-member.ts
/** A card is assigned only to someone of its workspace: the request named anyone else. */
export class AssigneeNotMember extends ValidationError {
  readonly code = 'card.assignee_not_member'
  constructor(userId: string) {
    super(`${userId} is not a member of this workspace: a card is assigned to one of its members`)
  }
}
```

`null` significa "nadie": entonces `newCard` no pregunta nada.

## Cuando lo otro desaparece: un worker limpia

Bajo una tarjeta pueden desaparecer dos cosas: su columna, y que su persona asignada
siga siendo miembro.

El módulo de columnas no puede arreglar las tarjetas: no sabe que existen. Y aunque
lo supiera, escribir en `card` desde una petición rompería la regla de escritura
([capítulo 17](./17-modules-talk)). Así que es `card` quien **escucha** el evento
`removed` de las columnas, desde un worker:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
// A card points at its column: when a column goes, no card is left in it.
deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
  strategy: 'handler',
  queue: 'card.leaveRemovedColumn.on.column.removed',
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A column was removed: any card still in it goes to the bottom of the board's
 * first column. What a worker calls; the second time, there are none.
 */
@UseCase()
async leaveRemovedColumn(column: ColumnDTO): Promise<void> {
  await runInWorkspace(column.workspaceId, async () => {
    const left = await this.repo.inColumn(column.id)
    if (left.length === 0) return
    const [first] = await this.deps.column.list(column.boardId)
    if (!first) return
    const bottom = await this.repo.count({ columnId: first.id })
    left.forEach((card, index) => card.moveTo(first.id, bottom + index, BOARDS))
    await this.repo.persistOrder(left, [column.id, first.id])
  })
}
```

`card.removeColumn` solo quita columnas vacías, así que normalmente esto no encuentra
nada. Está para la tarjeta que alguien movió a la columna justo cuando se quitaba.

La persona asignada funciona igual, entre contextos. auth avisa cuando alguien
pierde su acceso, y `card` le quita sus tarjetas:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
// auth took someone's access to a workspace: their cards there are left unassigned.
// auth tells every access it takes away, to any product: only a workspace's is boards'.
deps.access.revoked.subscribe(async access => {
  if (access.productId === WORKSPACES_PRODUCT && access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
}, {
  strategy: 'handler',
  queue: 'card.unassignMember.on.access.revoked',
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign(BOARDS)
    await this.repo.persist(...cards)
  })
}
```

Fíjate en tres detalles de los dos:

- **Buscan las tarjetas cuando corren**, no antes. El evento solo dice qué columna se
  quitó, o quién se fue. Las tarjetas se leen en ese momento, así que no se escapa
  ninguna que cambiara entre medias.
- **Se pueden repetir.** La segunda vez no hay tarjetas en la columna quitada, ni
  asignadas a quien se fue. No pasa nada.
- **No lo hizo nadie.** Los eventos de una tarjeta dicen quién la cambió (`by`) y por
  dónde (`via`). Aquí no fue una persona: fue boards, desde un worker. Así que el
  cambio lleva `BOARDS`, un autor con los dos vacíos:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** Boards' own work, from a worker: no one did it. */
const BOARDS: CardAuthor = { by: null, via: null }
```

Un worker corre fuera de cualquier petición, así que no tiene ámbito de espacio.
Entra en uno con `runInWorkspace`, que se fía del id: el evento ya dice qué espacio es.

## Al enseñar: componer, no unir

Una pantalla quiere "Planificar el lanzamiento · Bob", no `assigneeId: "0190…"`.
Nunca haces JOIN de los usuarios de auth con las tarjetas de boards. **Compones**:
lees cada parte de su dueño, y las juntas.

`workspace.members` compone dos lecturas de auth, los accesos al espacio y los
usuarios a los que corresponden:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async members(): Promise<WorkspaceMemberDTO[]> {
  const accesses = await everything(page => this.deps.auth.access.listForTenant(currentWorkspaceId(), page))
  const users = new Map((await this.deps.auth.user.getMany(accesses.map(access => access.userId))).map(user => [user.id, user]))
  return accesses.flatMap(access => {
    const user = users.get(access.userId)
    return user ? [{ id: user.id, name: user.name, email: user.email, isAdmin: access.role === 'admin' }] : []
  })
}
```

Un solo `getMany` con todos los ids, nunca una llamada por acceso. Y el servidor MCP
junta tarjetas y miembros para enseñar a cada persona asignada por su nombre:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
/** A card as the assistant reads it: its assignee by name too. */
function cardOf(card: CardDTO, members: WorkspaceMemberDTO[]) {
  const assignee = members.find(member => member.id === card.assigneeId)
  return {
    // …
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  }
}
```

La web de boards hace lo mismo en el navegador: pide el tablero y los miembros, y
los junta ella. Los miembros de un espacio son pocos, así que es lo más sencillo, y
basta casi siempre.

Si tuvieras que buscar o listar a gran escala por un nombre que vive en otro módulo,
mantendrías un **modelo de lectura**: una tabla que un worker rellena con los eventos
de las dos partes, pensada para esa pantalla (el [capítulo 22](./22-backoffice)
enseña la parte de analítica de esto).

## Lo que se acepta

Entre que `assign` comprueba al miembro y guarda la tarjeta, auth podría sacar a esa
persona. O el worker que le quita las tarjetas podría tardar un momento en correr.
Durante ese rato, una tarjeta apunta a alguien que ya no es miembro.

**Se acepta.** Es el precio de que cada módulo sea dueño de lo suyo, y es pequeño:
el evento `access.revoked` llega, el worker corre, y la tarjeta se queda sin asignar.
El código que lee la persona asignada más tarde tampoco se fía a ciegas:
`notifyAssignee` vuelve a preguntar a `member.find`, y no envía nada si ya no está.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
if (!member) return
```

## Cómo comprobarlo

El test de la tarjeta comprueba la persona asignada, con el auth de mentira:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
  const plan = await create('Plan')

  await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })
  // …
})
```

El test del espacio quita una columna con una tarjeta todavía dentro, como si
alguien la hubiera movido en ese instante, y espera al worker:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
// As if a card were moved into it while it was being removed: the column goes with a card in it.
await inAcme(() => t.modules.column.remove(todo.id))
await t.settled()

const view = await inAcme(() => t.modules.workspace.boardView(board.id))
expect(view.columns.map(column => column.name)).toEqual(['Doing', 'Done'])
```

Y el test de punta a punta de cooper saca a Bob de Acme en el auth de verdad, y
comprueba que su tarjeta se queda sin asignar un momento después:

```ts
// cooper/backend/cooper.test.ts
expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${bob.id}`)).status).toBe(204)
expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
await settled()

expect((await call<{ assigneeId: string | null }>(ana.as, 'GET', `/workspaces/${acme.id}/cards/${card.id}`)).body.assigneeId).toBeNull()
```

```bash
bun test cooper/backend
```

## En resumen

- Un módulo apunta a los datos de otro **por su id**. Sin entidades dentro, sin
  nombres copiados, sin JOIN.
- **Al escribir**, comprueba la referencia con una lectura a su dueño, cada vez. Si
  no existe, es un 400.
- **Cuando desaparece**, el módulo que apunta a ella escucha el evento y limpia
  desde un worker. Lee lo que hay que arreglar cuando corre, y puede repetirse.
- **Al enseñar**, compón lecturas (un `getMany`, no una llamada por cada uno). Un
  modelo de lectura solo si tienes que buscar entre módulos a gran escala.
- Durante un momento, una referencia puede apuntar a nada. Se acepta.
