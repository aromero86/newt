# Reglas que abarcan varias filas

Una versión protege **una fila** (capítulo [7](./07-concurrency)). Algunas reglas
hablan de **varias**:

- El nombre de un tablero es único en su espacio de trabajo, sin mirar mayúsculas.
- Un tablero tiene como mucho 10 columnas.
- Un espacio de trabajo tiene un administrador, y solo uno.
- Un email es de una sola cuenta.

Ninguna se puede comprobar mirando la fila que se guarda. Este capítulo enseña cómo las
comprueba newt, igual en todos los stores.

## Lo que se escapa al comprobar antes

Un tablero tiene 9 columnas. Ana y Bob añaden una cada uno en el mismo momento. Cada
caso de uso cuenta primero: "9 columnas, cabe". Los dos pasan, los dos guardan, y el
tablero acaba con 11.

```text
Ana   cuenta las columnas: 9
Bob   cuenta las columnas: 9
Ana   guarda su columna     → 10
Bob   guarda su columna     → 11  ✗
```

Ninguna versión ayuda: las dos columnas son filas nuevas, y ninguna toca a la otra. La
comprobación previa no basta, porque entre comprobar y guardar puede colarse otro.

## Comprobar dentro del guardado, y decir qué se protege

`save`, el guardado en bruto que hay detrás de `persist`, acepta tres opciones que
actúan **dentro de su transacción**:

- **`guard`** dice **qué** protege el guardado, con unas claves que eliges tú
  (`columns:<id del tablero>`);
- **`before`** hace lo que tiene que ir primero;
- **`after`** se ejecuta cuando las entidades ya están escritas: comprueba la regla y,
  si no se cumple, lanza un error que **lo deshace todo**.

La promesa del store es esta: **dos guardados con la misma clave nunca se
entrelazan**. Uno espera a que el otro confirme o deshaga, y solo entonces empieza a
escribir y a comprobar. Lo que lee el `after` es la verdad, y lo seguirá siendo hasta
que confirme.

Así se añade una columna:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
/**
 * Saves a new column at the end of its board, only if the board is left with no more
 * than `MAX_COLUMNS`: a rule over several rows, which no version covers (ch. 10). The
 * save guards its board's columns: its place is read before writing it, and the
 * columns counted after, with no other column of the board added, moved or removed
 * in between, in any store. Ten added at once to a board of five: five get in.
 */
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

`this.write` es la escritura que ya trae `TableRepository`. La clave es por tablero, no
una para todas las columnas: dos personas que añaden columnas al mismo tablero se
turnan, pero dos tableros no se esperan nunca. La misma clave protege `persistOrder`
(capítulo [6](./06-transactions)), así que mover y añadir en un tablero tampoco se
entrelazan nunca.

`before` le da a la columna nueva su sitio: el final del tablero, leído donde no puede
añadirse otra columna en medio.

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
/** A new one takes its place as it is saved: the end of its board, read where no other column can be added in between. */
place(position: number): void {
  if (!this.isNew) throw new Error(`Column ${this.id} is placed once, as it is added`)
  this.change({ position })
  this.trackEvent(new Column_Added(this.toDTO()))
}
```

El caso de uso sigue contando antes. Así da una respuesta clara en el caso normal, sin
abrir una transacción:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/** A new column, at the end of the board: a board has at most `MAX_COLUMNS`. */
@UseCase()
async add(boardId: string, input: ColumnAddDTO): Promise<ColumnDTO> {
  const { name } = ColumnAddSchema.parse(input)
  await this.deps.board.get(boardId)
  const count = await this.repo.count({ boardId })
  // For a clear answer in the usual case: the save counts again, where nothing slips in.
  if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
  const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
  await this.repo.persistAdded(column)
  return column.toDTO()
}
```

El error es un `ConflictError` (409), no un `ConcurrencyConflict`: el caso de uso no se
repite, porque volver a intentarlo no haría sitio.

```ts
// cooper/backend/contexts/boards/modules/column/errors/too-many-columns.ts
export class TooManyColumns extends ConflictError {
  readonly code = 'column.too_many'
  // …
}
```

Ahora la historia acaba bien:

```text
Ana   transacción: escribe, cuenta 10 ≤ 10 ✓, confirma
Bob   (espera a la clave columns:<tablero>)
Bob   transacción: escribe, cuenta 11 > 10 ✗, deshace → column.too_many
```

### Compruébalo

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('lets in only the columns that fit, when many are added at once', async () => {
  for (let i = 1; i <= 5; i++) await add(`Step ${i}`)

  const added = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => add(`More ${i}`)))

  expect(added.filter(each => each.status === 'fulfilled')).toHaveLength(5)
  for (const each of added.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'column.too_many' })
  expect((await names()).map(name => Number(name.split(':')[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})
```

Ocho columnas a la vez en un tablero de cinco: entran cinco, se rechazan tres, y las
posiciones van de 0 a 9 sin huecos.

## Por qué decirlo, si SQLite ya va por turnos

Porque **no todos los stores son iguales**, y tus módulos no deberían saber en cuál
corren:

| Store | Sin `guard` | Con `guard` |
|---|---|---|
| Ficheros, SQLite | Las transacciones ya van de una en una. | Igual: la clave ya está protegida. |
| Postgres, MySQL | Las transacciones corren a la vez: dos `after` podrían contar antes de que el otro confirme. | Un cerrojo por clave: los guardados con la misma clave se turnan. |

Declarar el `guard` cuesta una línea, y hace que la regla se cumpla en cualquier
store. Pasar `boards` de SQLite a Postgres (capítulo [26](./26-production)) no te
obliga a revisar nada.

Por eso un guardado con `after` **tiene que** decir su `guard`: sin él no compila. Si el
`after` no comprueba ninguna regla entre filas (solo escribe lo que se sigue del
guardado), escribe `guard: []`, y quien lo lea sabrá que no hace falta ninguno.

Postgres y MySQL corren en `READ COMMITTED` (en MySQL lo fija el store en cada
transacción). No hace falta pedir nada más estricto.

## Nombres únicos, sin mirar mayúsculas

El nombre de un tablero es la misma regla, con un recuento en lugar de un límite. La
clave del guard es el nombre en minúsculas, así que *Roadmap* y *ROADMAP* se turnan, y
el `after` cuenta con `ieq`, que no mira mayúsculas:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
/**
 * Saves a board only if no other one of its workspace has its name, whatever the
 * case: counted again after writing it, in its transaction, guarding the name in
 * lower case, so no other save of that name slips in between. `Roadmap` and
 * `ROADMAP` created at once cannot both have it (ch. 10).
 */
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

`count` solo ve el espacio actual (el scope del repositorio, capítulo
[5](./05-who-and-where)) y solo los tableros sin archivar (`softDelete`), así que el
nombre de un tablero archivado vuelve a quedar libre. `create` y `update` guardan los
dos con él, así que un cambio de nombre tampoco puede quitarle el nombre a otro.

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
  await create('Roadmap')

  await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
  expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')

  const bugs = await create('Bugs')
  await expect(inAcme(() => t.modules.board.update(bugs.id, { name: 'roadMAP' }))).rejects.toMatchObject({ code: 'board.name_taken' })
  // …
})
```

El email de una cuenta es la misma regla en auth, y enseña algo más: la tabla **no
tiene índice único** sobre el email. La regla vive solo en el guardado, así que se
cumple igual en cualquier store:

```ts
// cooper/backend/contexts/auth/modules/user/user.repository.ts
/**
 * Saves an account only if no other one has its email: checked after the write, in
 * its transaction, guarding that email, so two people signing up with it at once
 * cannot both get it. Emails are kept in lower case, so this is whatever the case
 * they were typed in. Any store keeps this rule the same way, with no unique index.
 */
async persistWithEmailFree(user: User): Promise<void> {
  await this.save([user], each => this.write(each), {
    guard: [`userEmail:${user.email}`],
    after: async () => {
      if (await this.count({ email: user.email }) > 1) throw new EmailTaken()
    },
  })
}
```

```sql
-- cooper/backend/contexts/auth/migrations/00001_user_up.sql
-- The accounts. An email belongs to one account: the user module checks it after each
-- save, in its transaction (a rule over rows any store can keep), so this index only
-- finds an account by its email quickly. Emails are kept in lower case.
CREATE INDEX user_email ON "user" (email);
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
const atOnce = await Promise.allSettled([signUp('Bob', 'bob@cooper.test'), signUp('Bob', 'BOB@cooper.test')])
expect(atOnce.map(each => each.status).sort()).toEqual(['fulfilled', 'rejected'])
```

## Un administrador por espacio

En auth, un espacio de trabajo tiene un único administrador: quien lo creó. Los accesos
son filas de `access`, una por miembro, con un `role`. "Como mucho un administrador" es
un recuento sobre las filas del espacio:

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
/**
 * Saves accesses keeping every tenant they touch with one admin at most: checked
 * after the writes, in their transaction, guarding each tenant's admin, so two
 * saves giving a tenant an admin at once cannot both succeed.
 */
async persistKeepingOneAdmin(...accesses: Access[]): Promise<void> {
  const tenants = [...new Set(accesses.map(access => access.tenantId).filter(tenantId => tenantId !== null))]
  await this.save(accesses, access => this.write(access), {
    guard: tenants.map(tenantId => `tenantAdmin:${tenantId}`),
    after: async () => {
      for (const tenantId of tenants) {
        if (await this.count({ tenantId, role: 'admin' }) > 1) throw new TenantHasAdmin(tenantId)
      }
    },
  })
}
```

Un guardado puede tocar varios espacios, así que protege una clave por espacio, y
comprueba cada uno. Un acceso del staff al backoffice no tiene espacio (`tenantId` es
null), y no protege nada.

"Nunca menos de uno" es la otra mitad, y no necesita guard: el acceso de un
administrador no se revoca nunca, así que nada puede dejar el recuento a cero.

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
const access = await this.resolve(() => this.repo.find({ userId, productId, tenantId }), () => new AccessNotFound())
if (access.role === 'admin') throw new AdminNotRevocable()
access.revoke()
await this.repo.persist(access)
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('keeps one admin, who is never removed; a member may be removed or leave', async () => {
  const [ana, bob, cai] = [await signUp('Ana'), await signUp('Bob'), await signUp('Cai')]
  const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

  await expect(modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'admin' })).rejects.toMatchObject({ code: 'access.tenant_has_admin' })
  await expect(as(ana, () => modules().access.revoke({ userId: ana.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.admin_not_revocable' })
  // …
})
```

## La versión y el guard

Recuerda el reparto:

- **La versión protege una fila**: nadie pisa una entidad que otro cambió (capítulo
  [7](./07-concurrency)).
- **El `guard` protege una regla entre varias filas**: nadie se cuela entre tu
  escritura y tu comprobación.

**En la práctica**: comprueba antes en el caso de uso, para dar una respuesta clara en
el caso normal, y **vuelve a comprobar en el `after`**, que es la garantía.

## En resumen

- Una regla sobre varias filas no se puede comprobar solo antes de guardar: alguien
  puede colarse en medio.
- Compruébala en el `after` del guardado, que lo deshace todo lanzando un error.
- Di qué protege en `guard`, con una clave tan estrecha como la regla (por tablero, por
  espacio, por nombre). Dos guardados con la misma clave nunca se entrelazan, en
  ningún store.
- Un guardado con `after` tiene que decir su `guard`; `guard: []` si no comprueba
  ninguna regla.
- `before` lee lo que necesita la fila nueva (su sitio al final) donde nadie se cuela.
- Mantén también la comprobación previa: da el error claro en el caso normal.
