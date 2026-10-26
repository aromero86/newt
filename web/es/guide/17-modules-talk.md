# Módulos que hablan entre sí

boards tiene seis módulos propios: `member`, `board`, `column`, `card`, `workspace` y
`activity` (más `session` y `outbox`, que comparten todos los contextos de cooper).
Una tarjeta necesita que existan su tablero y su columna. Un espacio de trabajo nuevo
necesita un tablero, tres columnas y una tarjeta. El registro de actividad de una
tarjeta necesita enterarse de lo que le pasa. Los módulos se necesitan todo el rato. Este capítulo va de cómo hablan sin pisarse los datos.

## Dos formas de hablar

Un módulo habla con otro de dos formas, y solo de dos:

| Forma | Cuándo | En cooper |
|---|---|---|
| **Llamar a un caso de uso** | Cuando necesitas la respuesta **ahora**: lecturas y comprobaciones. | `card.create` pregunta a `column.list` si la columna es del tablero. |
| **Escuchar un evento** | Cuando algo es **consecuencia** de otra cosa. | Al quitar una columna, `card` saca las tarjetas que quedaran en ella. |

Leer de otro módulo se puede siempre, desde donde sea. **Escribir** en otro módulo
tiene una regla:

> Un módulo escribe en otro **solo desde un worker** que reacciona a un evento.

## Por qué escribir pasa por un worker

Cada módulo guarda en **su propia transacción**. Mira `workspace.prepare`, que da a
un espacio nuevo su tablero de bienvenida. Escribe en tres módulos: crea un tablero,
luego las columnas, luego una tarjeta.

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

Cuatro guardados, en tres módulos, cada uno en su transacción. Imagina que lo
ejecutara una petición. El tablero se guarda, y el servidor se
reinicia antes de las columnas. La petición ya devolvió su error, y nada la vuelve a
intentar: el espacio se queda para siempre con un tablero sin columnas.

Por eso ninguna petición llama a `prepare`. Lo llama un worker cuando auth avisa de
que se creó un espacio:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
  strategy: 'handler',
  queue: 'workspace.prepare.on.tenant.created',
})
```

Si `prepare` falla a la mitad, su job **se repite** hasta que termina. Cada paso
busca primero lo que hizo una ejecución anterior (`findByName`, `addMissing`,
`createFirst`), así que repetirlo no hace daño
([capítulo 13](./13-repeatable-workers)). Y como un job puede llegar tarde, primero
pregunta si el espacio sigue ahí, y borra lo que escribió si el espacio se fue
mientras corría.

| Escribir en otro módulo desde… | Si falla a la mitad… |
|---|---|
| un caso de uso fuera de un worker (una petición, un script, un test) | queda a medias, y nadie lo termina |
| un caso de uso que llamó un worker | su job se repite hasta que termina |

Por eso lo que un worker escribe en otro módulo tiene que poder repetirse sin daño.

## newt lo vigila por ti

No hace falta que te acuerdes de la regla: newt la comprueba mientras la aplicación
funciona. Llama a `workspace.prepare` desde un test, fuera de un worker, y el primer
guardado en `board` falla. boards tiene un test que hace justo eso:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('refuses to prepare a workspace outside a worker: it writes in other modules', async () => {
  t.auth.join('acme', 'ana')

  await expect(inAcme(() => t.modules.workspace.prepare('acme'))).rejects.toThrow('[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo')
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
})
```

El error nombra el caso de uso que lo empezó todo (`workspace.prepare`), el módulo en
el que intentó escribir (`boards.board`) y las dos salidas. La segunda línea comprueba
que el guardado no se hizo: no hay tablero.

Lo que hace newt al encontrarlo lo decide la opción `writeRule` de la base:

| `writeRule` | Qué hace | Para |
|---|---|---|
| `'error'` | Lanza un error: el guardado no se hace. Es el valor por defecto. | Siempre. |
| `'warn'` | Un aviso en la consola, una vez por caso de uso y módulo en que escribe. | Una aplicación que se está pasando a la regla. |
| `'off'` | Nada. | Casi nunca. |

cooper se queda con el valor por defecto. Sus bases se crean sin la opción:

```ts
// cooper/backend/contexts/boards/boards.context.ts
const base = new BoardsBase({ name: 'boards', store, tracer })
```

Como por defecto es un error, una escritura fuera de sitio rompe un test en lugar de
esconderse en un aviso.

## Cuando saltarse la regla está justificado: `writesTo`

A veces un caso de uso tiene que escribir en otro módulo en la misma petición, y
merece la pena el riesgo. Entonces lo dices **donde se ve**, en el caso de uso, con
el porqué al lado.

Quitar una columna es el caso de cooper. Una columna solo se quita si no tiene
tarjetas. Pero el módulo `column` no sabe nada de tarjetas: `card` depende de
`column` (una tarjeta apunta a su columna), así que `column` no puede preguntar a
`card` sin que los dos se necesiten mutuamente. Quien puede responder "¿está vacía?"
es `card`. Así que el caso de uso es de `card`, y es él quien pide a `column` que la
quite:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Removes a column of a board, only if no card is in it. The cards answer, since a
 * card points at its column and a column knows nothing of the cards: the column
 * module cannot ask them without the two needing each other. So this use
 * case asks, and has the column module remove it: a write to another module outside
 * a worker, said where it is seen. It is the only write it makes, so a failure leaves
 * nothing halfway; a card moved into the column at that very moment is taken to
 * another one by `leaveRemovedColumn`.
 */
@UseCase({ writesTo: ['column'] })
async removeColumn(columnId: string): Promise<void> {
  const column = await this.deps.column.get(columnId)
  const cards = await this.repo.count({ columnId })
  if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
  await this.deps.column.remove(column.id)
}
```

Lee el comentario como la lista que todo `writesTo` debe cumplir:

- **Por qué no puede ser un worker.** La persona espera la respuesta: "quitada" o
  "no está vacía". Un worker respondería más tarde.
- **Por qué es seguro.** Es la única escritura que hace. Si falla, no se guardó
  nada. No hay "a medias".
- **Qué puede quedar suelto, y quién lo arregla.** Una tarjeta movida a la columna
  justo en ese instante acaba en una columna quitada. Un worker de `card` la saca
  ([capítulo 18](./18-references)).

La ruta vive con las tarjetas, porque son ellas quienes deciden:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
// A column is removed by the cards, which know whether it is empty.
workspace.delete('/columns/:columnId', async request => {
  await cards.removeColumn(request.params.columnId)
  return new Response(null, { status: 204 })
})
```

Y `column.remove` dice en su propio comentario que no es lo que llama la API:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * Removes a column, and the ones to its right move one place left. Whether it is
 * empty is not known here, where cards are not: `card.removeColumn` asks the cards
 * first, and is what the API calls. A card left in it anyway (moved in at that very
 * moment) is taken to another column by a worker of the cards.
 */
@UseCase()
async remove(id: string): Promise<void> {
  // …
}
```

El `writesTo` vale para todo lo que se escribe **por debajo** del caso de uso, lo
llame quien lo llame. Si otro caso de uso llamara a `card.removeColumn`, la columna
se quitaría igual; a ese otro solo le toca declarar lo que escribe él.

auth tiene cinco más, cada uno con su porqué en el código:

- `tenant.create` escribe en `access`: quien crea un espacio tiene que poder entrar
  en cuanto llega la respuesta. Si el segundo guardado falla, el worker de
  `tenant.created` da igualmente el administrador (`ensureAdmin`).
- `tenant.delete` escribe en `access`: nadie puede entrar en un espacio desde que su
  borrado responde. Si quitar los accesos falla, el worker de `tenant.deleted` los
  quita (`removeAccesses`); mientras tanto boards no deja entrar a nadie, porque
  pregunta también si el espacio sigue ahí.
- `invitation.accept` escribe en `access`: quien acepta entra al momento. El acceso
  va primero y se puede dar otra vez sin daño, así que aceptar de nuevo termina una
  aceptación a medias.
- `session.signUp` escribe en `user`: la persona espera su cuenta y su sesión en
  una sola respuesta.
- `token.exchange` escribe en `oauthGrant`: el cliente espera sus tokens en esta
  respuesta ([capítulo 20](./20-oauth-server)).

::: warning Cuidado
`writesTo` no es una forma de callar el error. Cada uno es una decisión con su
porqué, escrito al lado. Si no sabes escribir el porqué, usa un worker.
:::

## Las dependencias: `.deps.ts`

Un módulo declara los módulos que conoce en su fichero `.deps.ts`. Cada entrada dice
para qué lo necesita:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  access: AccessEvents
}
```

El contexto crea los módulos **en orden**, cada uno después de los que usa:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
const board = Board_Module.initialize(base, { member })
const column = Column_Module.initialize(base, { board, member })
const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
const { tenant, access, invitation, user } = deps.auth
const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants, auth: { tenant, access, invitation, user } })
const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
```

Las dependencias de boards no forman ningún círculo:

| Módulo | Usa |
|---|---|
| `member` | nada de boards (el puerto `Workspaces`) |
| `board` | `member` |
| `column` | `board`, `member` |
| `card` | `board`, `column`, `member` (y el puerto `AccessEvents`) |
| `workspace` | `board`, `column`, `card`, `member` (y auth) |
| `activity` | `card`, `member` (y el puerto `WorkspaceDeletions`) |

`workspace` y `activity` están arriba del todo. `workspace` pone a trabajar a los
demás; `activity` solo escucha los eventos de las tarjetas y lleva un registro de
ellos. Nadie depende de ninguno de los dos. `card` no sabe que sus eventos alimentan
un registro: añadir `activity` no cambió ni una línea de `card`.

## Puertos: una dependencia con tus palabras

Dos de las entradas de arriba no son módulos. `member` recibe `workspaces`, y `card`
recibe `access`. Los dos son **puertos**: un tipo que declara el propio módulo, con
sus palabras, para algo que necesita de fuera de su contexto.

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
/**
 * What `boards` needs to know of the workspaces, and asks whoever keeps them (auth's
 * tenants and access): a port, in boards' own words, so this module depends on no
 * module of auth. The context is handed one when it opens; a test, a fake.
 */
export type Workspaces = {
  /** Whether someone belongs to a workspace now, deleted it has nobody: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
  /** Whether a workspace is still there: deleted, a worker has nothing to write in it. */
  exists(workspaceId: string): Promise<boolean>
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
/**
 * auth's events the cards react to, as a port: what boards needs of them, in its own
 * words. auth's emitters fit it; a test hands its own.
 */
export type AccessEvents = {
  revoked: Pick<DomainEventEmitter<{ userId: string, productId: string, tenantId: string | null }>, 'subscribe'>
}
```

Un puerto te da dos cosas:

- **boards dice lo que necesita, no cómo funciona auth.** auth tiene tenants,
  productos y accesos. boards solo pregunta "¿esta persona es miembro de este
  espacio?".
- **Los tests le pasan un doble.** Los tests de boards lo abren con `FakeAuth`, que
  guarda los miembros en un mapa y publica los mismos eventos. Sin auth.

Quien abre el contexto conecta el puerto con lo de verdad. Lo verás en el
[capítulo 19](./19-several-contexts).

## Cómo comprobarlo

Los tests de boards cubren quitar una columna, por el caso de uso y por la API:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('removes a column only when no card is in it, and the others move left', async () => {
  const [todo, doing] = [await add('To do'), await add('Doing'), await add('Done')]
  const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo.id, title: 'Write the plan' }))

  await expect(inAcme(() => t.modules.card.removeColumn(todo.id))).rejects.toMatchObject({ code: 'card.column_not_empty' })

  await inAcme(() => t.modules.card.move(card.id, { columnId: doing.id }))
  await inAcme(() => t.modules.card.removeColumn(todo.id))
  expect(await names()).toEqual(['0:Doing', '1:Done'])
})
```

```bash
bun test cooper/backend/contexts/boards
```

## En resumen

- Un módulo habla con otro **llamando a sus casos de uso** (lecturas,
  comprobaciones) o **escuchando sus eventos** (consecuencias). Nunca por su
  repositorio, sus tablas ni su entidad.
- **Lee de cualquiera; escribe en otro módulo solo desde un worker.** newt lo
  comprueba (`writeRule: 'error'` por defecto).
- Un `writesTo` es una decisión, escrita donde se ve, con su porqué: por qué no
  puede esperar, por qué es seguro y quién arregla lo que quede suelto.
- Cada módulo lista lo que conoce en su `.deps.ts`. **Las dependencias nunca forman
  un círculo**: si dos módulos parecen necesitarse, uno deja de llamar y pasa a
  escuchar, o el caso de uso se lo queda quien sabe la respuesta (`card.removeColumn`).
- **Un módulo no sabe quién depende de él.** `column` no sabe que hay tarjetas.
- Lo que un módulo necesita de fuera de su contexto es un **puerto**, con sus
  palabras.
