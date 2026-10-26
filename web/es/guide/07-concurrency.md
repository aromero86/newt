# Dos personas, una tarjeta

Ana y Bob abren el mismo tablero. Ana arrastra la tarjeta #1 a *Doing*; en el mismo
momento, Bob la arrastra a *Done*. Los dos guardan. ¿Qué queda?

Sin protección, el segundo guardado pisaría al primero con lo que leyó antes, y el
movimiento de Ana desaparecería sin que nadie se enterase. Aquí sería peor: cada
movimiento reescribe también las posiciones de las tarjetas de alrededor, así que la
columna podría quedarse con dos tarjetas en un sitio y un hueco en otro. Este capítulo
enseña cómo lo evita newt, y cuándo no debe volver a intentarlo por su cuenta.

## La versión

Cada fila guardada tiene una **versión** que sube con cada guardado que la escribe. Al
guardar, el framework comprueba que la fila sigue en la versión que se leyó. Si
alguien la ha guardado entre medias, la versión ya no coincide, y el guardado falla
con un **`ConcurrencyConflict`** (409) sin escribir nada.

```text
Ana   lee la tarjeta #1 (versión 3)
Bob   lee la tarjeta #1 (versión 3)
Ana   guarda el movimiento, si sigue en la 3   → hecho: ahora versión 4
Bob   guarda el movimiento, si sigue en la 3   → ConcurrencyConflict: está en la 4
```

Nadie pierde nada en silencio. No escribes nada de esto: cada fila de un
`TableRepository` tiene su `version`, como dicen los tipos de las filas.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
export type CardRow = CardDTO & { version: number }
```

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
CREATE TABLE card (
  id TEXT PRIMARY KEY,
  -- …
  version INTEGER NOT NULL
);
```

## Volver a intentarlo, solo

Que Bob recibiera un error sería correcto, pero casi siempre lo sensato es **volver a
intentarlo**: leer la tarjeta otra vez, ya en *Doing*, moverla a *Done* y guardar. Eso
hace todo caso de uso, sin que se lo pidas. Ante un conflicto se ejecuta de nuevo
**desde el principio**, hasta tres veces más.

Mira otra vez `card.move` (capítulo [6](./06-transactions)): carga la tarjeta y sus
columnas, decide, y guarda al final. Al repetirse, carga la tarjeta tal como la dejó
Ana. Los dos movimientos ocurren, uno detrás del otro, y las columnas no quedan con
huecos.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Moves a card to a column of its board (the same one, too) at a position, and the
 * cards around take the places left and made: several cards saved at once, all or
 * none. Whoever moved one of them meanwhile, this card too, makes it run again from
 * the start, with the columns as they are then: two people dragging the same card
 * at once both get their move, one after the other.
 */
@UseCase()
async move(id: string, input: CardMoveDTO): Promise<CardDTO> {
  const { columnId, position } = CardMoveSchema.parse(input)
  const card = await this.load(id)
  // …
  await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
  return card.toDTO()
}
```

Funciona porque un caso de uso **carga, cambia y guarda, y no hace nada irreversible
antes de guardar**. Lo que no se puede deshacer (un email) sale de un worker, después
del guardado (capítulo [14](./14-irreversible)). Un caso de uso que mandara un email y
después guardara lo mandaría dos veces al reintentar.

Cuando un caso de uso llama a otro, solo se repite **el primero de la cadena**, con todo
lo que llama. El de dentro deja pasar el conflicto hasta él, y se ejecuta de nuevo en
cada intento del de fuera. Si no, el de dentro repetiría lo que su llamador vuelve a
repetir después.

### Un conflicto sin versión

Una versión protege las filas que se leyeron. Una fila que **no existía** cuando el
caso de uso leyó no tiene versión que comprobar. Si Carla crea una tarjeta en *Doing*
mientras el movimiento de Bob renumera esa columna, el guardado de Bob no toca la
tarjeta de Carla, y la columna podría acabar con dos tarjetas en la misma posición.

`persistOrder` lo cubre. Después de escribir, dentro de la misma transacción, lee cada
columna que ha tocado y comprueba que las posiciones van 0, 1, 2… sin huecos. Si no,
alguien ha colado una tarjeta, y lanza el mismo `ConcurrencyConflict`. El caso de uso
se repite con la columna como está ahora:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves cards in their new order, all of them or none: the one moved or
 * deleted, and the ones that took the places left, in each column it touches. Each
 * was read at a version, so a card someone else moved meanwhile makes it a
 * conflict, and the use case runs again with the columns as they are then.
 * One created meanwhile has no version here: the order of each column is checked
 * whole after writing, guarding those columns, so it is a conflict too.
 */
async persistOrder(cards: Card[], columnIds: string[]): Promise<void> {
  const columns = [...new Set(columnIds)]
  await this.save(cards, each => this.write(each), {
    guard: columns.map(columnId => `cards:${columnId}`),
    after: async () => {
      for (const columnId of columns) {
        const positions = (await this.inColumn(columnId)).map(card => card.position)
        if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
      }
    },
  })
}
```

El `guard` asegura que ningún otro guardado de esas columnas se cuele entre la
escritura y la comprobación. El capítulo [8](./08-rules-over-rows) trata de esa
pareja.

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives each of two moves of the same card at once its turn, and leaves no gap', async () => {
  const [plan] = [await create('Plan'), await create('Design'), await create('Build')]

  const moved = await Promise.all([
    inAcme(() => t.modules.card.move(plan.id, { columnId: doing })),
    inAcme(() => t.modules.card.move(plan.id, { columnId: done })),
  ])

  expect(moved.map(card => card.columnId).sort()).toEqual([doing, done].sort())
  const after = await columns()
  expect(after.todo).toEqual(['#2@0', '#3@1'])
  expect([...after.doing, ...after.done]).toEqual(['#1@0'])
})
```

Las dos llamadas salen bien. Una de ellas se ejecutó dos veces, y la tarjeta acabó
donde la puso la segunda. Con las columnas pasa lo mismo:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('gives each of two moves at once its turn, and leaves no gap', async () => {
  const [todo, doing, done] = [await add('To do'), await add('Doing'), await add('Done')]

  await Promise.all([
    inAcme(() => t.modules.column.move(done.id, { position: 0 })),
    inAcme(() => t.modules.column.move(todo.id, { position: 2 })),
  ])

  const order = await names()
  expect(order.map(name => name.split(':')[0])).toEqual(['0', '1', '2'])
  // …
})
```

## Cuando no debe repetirse

Algunos casos de uso hacen algo antes de guardar que no puede pasar dos veces: una
llamada a otro contexto, o un guardado propio que una segunda vuelta repetiría. Lo
dicen donde se ve, con el motivo al lado: `retryOnConflict: false`. Vale para toda la
cadena: ninguno se repite, tampoco los que lo llamaron, aunque sean de otro contexto.

cooper tiene cuatro, y cada uno con su motivo.

**`tenant.create` de auth** guarda el espacio de trabajo, y después el acceso de su
administrador. Si ese segundo guardado chocara y el caso de uso se repitiera, crearía
un **segundo espacio**:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * A new workspace, made by the signed-in person, who is its admin. It writes to
 * `access` without being a worker, on purpose: whoever makes a workspace enters it
 * the moment it answers. The workspace is saved first and its admin after; should
 * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it;
 * whichever of the two gives it second finds it given.
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

`boards` lo llama desde su ruta `POST /api/workspaces`. Ahí también cuenta: la llamada
empieza en auth, y auth dice que no se repite.

**`tenant.delete` de auth** tiene la misma forma: guarda el espacio como borrado, y
después le quita sus accesos (capítulo [6](./06-transactions)). Si se repitiera tras el
primer guardado, encontraría el espacio ya borrado, y le respondería "no existe" al
administrador que acaba de borrarlo.

**`token.exchange` de auth** gasta el código de autorización (un guardado en
`oauthGrant`) antes de guardar los tokens. Si se repitiera, traería el mismo código por
segunda vez, y un código que llega dos veces parece **copiado**: auth revoca todos los
tokens que dio.

```ts
// cooper/backend/contexts/auth/modules/token/token.module.ts
/**
 * A client trades its code for tokens. It writes to `oauthGrant` without being a
 * worker, on purpose: the client waits for its tokens in this answer. The code is
 * spent first, then the tokens saved; should that fail, the client signs the person
 * in again. It never runs again on a conflict: the code it spent would look copied.
 */
@UseCase({ writesTo: ['oauthGrant'], retryOnConflict: false })
async exchange(input: TokenExchangeDTO): Promise<TokenPairDTO> {
  const { clientId, clientSecret, code, codeVerifier, redirectUri } = TokenExchangeSchema.parse(input)
  const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
  const grant = await this.deps.oauthGrant.redeem({ code, codeVerifier, clientId: client.clientId, redirectUri })

  const { token, pair } = Token.issue(grant, this.options)
  await this.repo.persist(token)
  return pair
}
```

Esto es lo que hace `redeem` con un código que ya canjeó:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
if (grant.status === 'redeemed') {
  grant.replay()
  await this.repo.persist(grant)
  throw new InvalidGrant()
}
```

**`complete` de la sesión web** (capítulo [5](./05-who-and-where)) llama a auth por
HTTP antes de guardar su sesión. El código se gasta en cuanto auth responde: una
segunda vuelta solo podría fallar.

```ts
// cooper/backend/shared/web-session/web-session.module.ts
/**
 * auth sent the browser back: the code is traded for who signed in, and the
 * context's own session is opened. It calls auth over HTTP before saving, so it
 * never runs again on a conflict: the code is spent.
 */
@UseCase({ retryOnConflict: false })
async complete(input: { code?: string, state?: string, error?: string, errorDescription?: string, pending?: string }): Promise<{ token: SecretToken, returnTo: string }> {
  // …
  const tokens = await this.post('/oauth/token', { grant_type: 'authorization_code', code: input.code, redirect_uri: this.redirectUri(), code_verifier: pending.verifier })
  // …
  const { session, token } = WebSession.open(identity.userId, this.options.days)
  await this.repo.persist(session)
  return { token, returnTo: pending.returnTo }
}
```

::: tip Consejo
Antes de escribir `retryOnConflict: false`, mira si puedes reordenar el caso de uso
para que guarde una vez, al final. La opción es para lo que no se puede.
:::

## Nuevos que chocan

Con las altas pasa lo mismo. El nombre de un tablero es único en su espacio de
trabajo, sin mirar mayúsculas. Si Ana y Bob crean *Roadmap* en el mismo momento, uno de
los dos guardados tiene que perder.

`board` tiene tres defensas, y cada una tiene su papel.

El **índice único** es la garantía cuando llegan dos a la vez. En SQLite está sobre el
nombre en minúsculas, y solo para los tableros sin archivar:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

Una fila nueva que choca con un índice único también es un `ConcurrencyConflict`. Un
store cuya estructura no sabe decirlo (el de ficheros) lee la misma regla de la opción
`unique` de la tabla, pero solo para el valor exacto:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
```

La **comprobación dentro del guardado** cubre el resto, en cualquier store: *Roadmap* y
*ROADMAP* a la vez. `persistWithNameFree` vuelve a contar el nombre, sin mirar
mayúsculas, después de escribir, y protege el nombre en minúsculas para que ningún otro
guardado de ese nombre se cuele en medio:

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

El capítulo [8](./08-rules-over-rows) lo explica entero.

La **comprobación antes de guardar** da un **error claro**, `board.name_taken`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
@UseCase()
async create(input: BoardCreateDTO): Promise<BoardDTO> {
  const { name, description } = BoardCreateSchema.parse(input)
  await this.assertNameFree(BoardName.from(name))
  const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
  await this.repo.persistWithNameFree(board)
  return board.toDTO()
}

// …
/** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
  if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
}
```

La comprobación previa también importa para los reintentos. Cuando el índice rechaza
el segundo guardado, el conflicto vuelve a ejecutar `create`; esta vez `assertNameFree`
encuentra *Roadmap* y responde `board.name_taken`, no un conflicto a secas. Sin ella, un
nombre repetido se intentaría cuatro veces para nada antes de devolver el conflicto: el
choque con un valor único no se arregla reintentando.

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one of several boards created with it at once, whatever its case', async () => {
  const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

  expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
  for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
})
```

## En resumen

- Cada fila tiene una versión. Guardar una fila que otro ha guardado desde que la
  leíste es un `ConcurrencyConflict` (409), y no se escribe nada.
- Ante un conflicto, el caso de uso se repite desde el principio, hasta tres veces más.
  Solo el primero de la cadena, con todo lo que llama.
- Por eso un caso de uso carga, cambia y guarda al final, y no hace nada irreversible
  antes de guardar.
- Una fila creada entre medias no tiene versión: comprueba el orden entero dentro del
  guardado, y lanza `ConcurrencyConflict` si alguien se ha colado.
- `retryOnConflict: false`, con el motivo al lado, para un caso de uso que hizo algo
  antes de guardar que no puede pasar dos veces.
- Un valor único tiene tres defensas: el índice (la garantía), la comprobación dentro
  del guardado (sin mirar mayúsculas, en cualquier store) y la de antes (el error
  claro).
