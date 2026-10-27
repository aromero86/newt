# Sagas: un workspace llega y se va

Ana se registra y crea un workspace, acme. auth guarda los workspaces (los llama
tenants), y emite `tenant.created`. Un momento después, acme debería tener en boards un
tablero con el que empezar: *Welcome*, con *To do*, *Doing* y *Done*, y una primera
tarjeta que le diga qué hacer. Cuando se borra acme, auth emite `tenant.deleted`, y todo
lo que acme tenía en boards debería irse: sus tarjetas, sus columnas, sus tableros, su
actividad.

Ninguna de las dos cosas es un solo guardado. El tablero de bienvenida es un tablero, tres
columnas y una tarjeta: cuatro guardados, en tres módulos. El borrado son filas de tres
módulos y las del registro. Cualquiera de esos guardados puede fallar, o el servidor puede
pararse entre dos de ellos. Ninguna transacción puede abarcarlo todo: cada módulo guarda
en la suya.

Un trabajo hecho de pasos, cada uno en su propia transacción, es una **saga**. Este
capítulo escribe las dos de boards: preparar un workspace y purgar uno. Funcionan por dos
cosas a la vez: un worker ejecuta el trabajo otra vez hasta que se completa, y cada paso
encuentra lo que hizo una ejecución anterior, de modo que ejecutarlo otra vez **converge**
en el mismo final.

## Un módulo propio: workspace

Ninguna de las sagas pertenece al módulo de tableros, de columnas ni de tarjetas: cada una
pone a trabajar a los tres. Así que boards tiene un módulo para lo que un workspace es en
boards, `workspace`. No guarda ninguna tabla propia. Reacciona a los eventos de auth sobre
workspaces, escribe en los otros módulos desde un worker y, ya que está, los lee todos a
la vez para la pantalla de un tablero.

### Sus deps: los eventos de auth sobre workspaces

Como en el [capítulo 13](./13-another-context), lo que el módulo necesita de auth es un
puerto en sus propias deps, con palabras de boards: dos `EventSource`, con solo el id del
workspace en su payload. Crea `modules/workspace/workspace.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.deps.ts
import type { EventSource } from 'newt/core'
import type { Board_Module } from '../board/board.module'
import type { Card_Module } from '../card/card.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

/**
 * auth's events about workspaces (its tenants) that boards reacts to, as a port: what
 * boards needs of them, in its own words. auth's emitters fit it; a test hands its own.
 */
export type TenantEvents = {
  created: EventSource<{ id: string }>
  deleted: EventSource<{ id: string }>
}

export interface Workspace_Deps {
  board: Board_Module
  column: Column_Module
  card: Card_Module
  member: Member_Module
  tenants: TenantEvents
}
```

Conoce los tres módulos en los que escribe, y `member`, para preguntar si un workspace
sigue ahí (más abajo).

### Su esquema: el tablero de bienvenida y la pantalla de un tablero

Crea `modules/workspace/workspace.schema.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.schema.ts
import type { BoardDTO } from '../board/board.schema'
import type { CardDTO } from '../card/card.schema'
import type { ColumnDTO } from '../column/column.schema'

/** A board as its screen shows it: the board, its columns from left to right, and their cards from the top. */
export type BoardViewDTO = {
  board: BoardDTO
  columns: ColumnDTO[]
  cards: CardDTO[]
}

/** The board every new workspace starts with. */
export const WELCOME_BOARD = {
  name: 'Welcome',
  description: 'A first board to find your way around: move the card, add your own.',
  columns: ['To do', 'Doing', 'Done'],
  card: {
    title: 'Welcome to Cooper',
    description: 'Drag this card to Doing, then to Done. Add columns and cards of your own, and assign them to the people of your workspace.',
  },
} as const
```

`WELCOME_BOARD` es con lo que empieza todo workspace nuevo, en un solo sitio.
`BoardViewDTO` es un tablero tal como lo muestra su pantalla, para que un cliente dibuje
un tablero con una petición en vez de tres.

## Preparar un workspace

Crea `modules/workspace/workspace.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { Workspace_Deps } from './workspace.deps'
import { registerWorkspaceRoutes } from './workspace.routes'
import { WELCOME_BOARD, type BoardViewDTO } from './workspace.schema'
import { registerWorkspaceWorkers } from './workspace.workers'

/**
 * A workspace as `boards` has it: what its boards, columns and cards are together.
 * It keeps nothing of its own: it puts the other modules to work, from a worker when
 * it writes in them, and reads them all at once for a board's screen.
 */
export class Workspace_Module extends Module {

  static initialize(base: BoardsBase, deps: Workspace_Deps): Workspace_Module {
    const module = new Workspace_Module(base, deps)
    registerWorkspaceRoutes(base, module, deps)
    registerWorkspaceWorkers(module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly deps: Workspace_Deps) {
    super('workspace', base.invocations, deps)
  }

  /** A board, its columns and its cards, in the current workspace: one screen. */
  @UseCase()
  async boardView(boardId: string): Promise<BoardViewDTO> {
    const board = await this.deps.board.get(boardId)
    const [columns, cards] = await Promise.all([this.deps.column.list(boardId), this.deps.card.listInBoard(boardId)])
    return { board, columns, cards }
  }

  /**
   * A new workspace gets its welcome board: "Welcome", with To do, Doing and Done, and
   * a first card. A worker calls it once auth created the workspace (eventual
   * consistency: for a moment, the workspace has no board), and it writes in three
   * modules, which only a worker may: if it fails halfway, its job runs it again.
   * Each step looks for what an earlier run did first, so a second run only finishes
   * what the first left, and adds nothing to a finished one; two runs at once add
   * each column and the card once, since their saves look again.
   *
   * A workspace auth deleted meanwhile gets nothing: its job may run late, after the
   * workspace's purge. One deleted while it runs has what it wrote purged again.
   */
  @UseCase()
  async prepare(workspaceId: string): Promise<void> {
    if (!await this.deps.member.exists(workspaceId)) return
    await runInWorkspace(workspaceId, async () => {
      const board = await this.deps.board.findByName(WELCOME_BOARD.name)
        ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
      const [todo] = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
      await this.deps.card.createFirst(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
    })
    if (!await this.deps.member.exists(workspaceId)) await this.purge(workspaceId)
  }

  /**
   * auth deleted a workspace: its cards, columns and boards go, in that order. boards'
   * step of that deletion: it cannot be undone, nor needs to be; a worker
   * runs it until it completes, and each part removes what is left, so running it
   * again after a failure halfway converges on a workspace with nothing.
   */
  @UseCase()
  async purge(workspaceId: string): Promise<void> {
    await this.deps.card.purgeWorkspace(workspaceId)
    await this.deps.column.purgeWorkspace(workspaceId)
    await this.deps.board.purgeWorkspace(workspaceId)
  }
}
```

`boardView` lee tres módulos, y leer siempre está bien desde cualquier sitio: una llamada
a cada uno. Se ejecuta en el workspace actual, como el caso de uso de cualquier ruta.

`prepare` es la primera saga. Lee su cuerpo como cuatro pasos:

1. El tablero: el llamado *Welcome* si ya hay uno, o uno nuevo.
2. Las columnas: las de los tres nombres que el tablero aún no tiene. `addMissing`
   responde las columnas del tablero con esos nombres, en su orden, así que la primera
   es *To do*, haya lo que haya antes.
3. La tarjeta: la primera del tablero, salvo que ya tenga una.
4. Antes y después, si el workspace sigue ahí.

El worker que lo llama no se ejecuta en ningún workspace, así que los pasos van dentro de
`runInWorkspace(workspaceId, …)`: el evento nombró el workspace.

### Cada paso encuentra lo que hizo una ejecución anterior

Imagina que `prepare` falla después de guardar el tablero y una columna. Su job se
ejecuta otra vez, desde el principio. Si cada paso solo creara, la segunda ejecución
añadiría un segundo tablero *Welcome*. En cambio, cada paso pregunta primero:

- `board.findByName` encuentra el tablero *Welcome* que guardó la primera ejecución, sea
  cual sea su capitalización (los nombres de tablero son únicos por workspace, sin
  distinguir mayúsculas, desde el [capítulo 6](./06-rules-over-rows)). Solo si no hay
  ninguno lo crea `board.create`.
- `column.addMissing` añade solo los nombres que el tablero no tiene, sea cual sea su
  capitalización: un *TO DO* que dejó la primera ejecución es *To do*.
- `card.createFirst` crea la tarjeta solo si el tablero no tiene ninguna.

Así que la segunda ejecución termina lo que dejó la primera, y una ejecución sobre un
tablero terminado no añade nada. Eso es lo que significa "seguro de ejecutar otra vez"
para un paso que crea: **busca su resultado antes de hacerlo.**

Los dos casos de uso nuevos van en sus módulos. En `column.module.ts`, añade `addMissing`
después de `add`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Adds at the end of the board the columns of these names it does not have yet,
   * whatever the case (`to do` is `To do`, as boards' names), and answers the board's
   * columns of these names, in their order: what a worker preparing a board calls, as
   * many times as it takes. Runs at once add each name once: the save checks it again.
   */
  @UseCase()
  async addMissing(boardId: string, input: string[]): Promise<ColumnDTO[]> {
    await this.deps.board.get(boardId)
    const names = input.map(name => ColumnAddSchema.parse({ name }).name)
    const columns = await this.repo.ofBoard(boardId)
    const added: Column[] = []
    for (const name of names) {
      if ([...columns, ...added].some(column => column.isNamed(name))) continue
      added.push(Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: columns.length + added.length }))
    }
    if (columns.length + added.length > MAX_COLUMNS) throw new TooManyColumns(boardId)
    if (added.length > 0) await this.repo.persistMissing(added, boardId)
    const all = [...columns, ...added]
    return names.map(name => all.find(column => column.isNamed(name))!.toDTO())
  }
```

- Interpreta cada nombre una vez, como hace `add` (sin espacios sobrantes, comprobado),
  antes de comparar.
- Compara los nombres con el `isNamed` de la propia columna, más abajo: sea cual sea su
  capitalización, como se comparan los nombres de boards desde el [capítulo
  6](./06-rules-over-rows). Sin él, un tablero cuya primera ejecución dejó *TO DO*
  tendría un segundo *To do*.
- Cada nombre se busca entre las columnas del tablero **y** las añadidas hasta ahora,
  así que una lista que nombra una columna dos veces la añade una vez.
- Responde, para cada nombre pedido, la columna del tablero con ese nombre, en el orden
  pedido: quien llama sabe cuál es cuál sin volver a buscar por nombre. `prepare` toma
  la primera, `const [todo] =`.

`isNamed` va en `column.ts`, después del getter `position`, con una función `fold` al
final del archivo:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
  /** Whether it has this name, whatever the case, as boards' names: only A to Z folded, as `ieq` compares. */
  isNamed(name: string): boolean {
    return fold(this.data.name) === fold(name)
  }
// …
function fold(name: string): string {
  return name.replace(/[A-Z]/g, letter => letter.toLowerCase())
}
```

`fold` pasa a minúsculas de la A a la Z y deja cualquier otra letra como está:
exactamente lo que compara `ieq` en la base de datos (el capítulo
[6](./06-rules-over-rows) contó por qué las dos cosas deben plegar igual). Un nombre
comparado de una forma en memoria y de otra en el guardado haría que el guardado
encontrara un duplicado que el caso de uso no vio, o que se le escapara uno.

En `card.module.ts`, añade `createFirst` después de `create`. Su autor es `BOARDS`, del
capítulo 13: nadie creó la tarjeta de bienvenida.

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

### Dos ejecuciones a la vez

Mirar primero basta para una ejecución que viene después de otra. No basta para dos
ejecuciones a la vez: las dos miran, las dos no encuentran nada, las dos crean. Pasa:
auth puede emitir el evento dos veces, o un job puede reclamarse otra vez mientras su
primera ejecución sigue en marcha. El guardado de cada paso comprueba otra vez, dentro de
su transacción, como aprendiste en el [capítulo 8](./08-two-people-one-card):

- El tablero: el índice único de la tabla sobre (workspace, nombre) rechaza el segundo
  *Welcome*. El guardado lanza `DuplicateValue`.
- Las columnas: `persistMissing`, más abajo, cuenta cada nombre después de escribir,
  sea cual sea su capitalización.
- La tarjeta: `persistNew` cuenta las tarjetas del tablero después de escribir.

Las dos últimas llaman a `this.conflict()` cuando descubren que otra ejecución llegó
antes. Un `DuplicateValue` también es un `ConcurrencyConflict`. Y ante un conflicto, el
caso de uso se ejecuta otra vez: **el primer caso de uso de la cadena**, aquí `prepare`,
desde el principio, con todo lo que llama. La segunda vez, `findByName` encuentra el
tablero, `addMissing` encuentra las columnas, `createFirst` encuentra la tarjeta. Tres
ejecuciones a la vez desde cero dejan un tablero, tres columnas y una tarjeta, y los tres
jobs terminan en su primer intento.

Añade `persistMissing` a `column.repository.ts`, después de `persistAdded`. Es
`persistAdded` para varias columnas, con una comprobación más:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  /**
   * Saves new columns at the end of their board, as `persistAdded` does, where none
   * of the board's other columns has their names, whatever the case: checked again after writing them,
   * guarding the board's columns. A save that finds one already there (another run
   * of the same work added it meanwhile) is a conflict, and the use case runs again,
   * finding it.
   */
  async persistMissing(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => {
        const count = await this.count({ boardId })
        columns.forEach((column, index) => column.place(count + index))
      },
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
        for (const column of columns) {
          if (await this.count({ boardId, name: { ieq: column.name } }) > 1) this.conflict()
        }
      },
    })
  }
```

Cuenta con `{ ieq: column.name }`: la misma comparación que `isNamed`, ahora en la base
de datos, así que un *TO DO* y un *To do* guardados por dos ejecuciones a la vez son un
mismo nombre dos veces, y un conflicto.

Y dale a `persistNew` en `card.repository.ts` una opción, `first`, y su comprobación:

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

`create` sigue llamando a `persistNew(card)`, sin opciones: solo la tarjeta de bienvenida
insiste en ser la primera.

### Un job que se ejecuta tarde

Un job puede ejecutarse mucho después de su evento: una cola acumulada, un reinicio,
reintentos con espera. Para entonces auth puede haber borrado el workspace, y boards
puede haberlo purgado ya. Un `prepare` que se ejecutara entonces le daría a un workspace
borrado un tablero de bienvenida, y nada lo quitaría nunca.

Así que `prepare` pregunta primero si el workspace sigue ahí, y no escribe nada si no.
Y pregunta otra vez al final: si el workspace se fue mientras se ejecutaba, puede que la
purga se ejecutara antes de sus escrituras, así que purga otra vez él mismo. En el orden
en que se ejecuten los dos jobs, un workspace borrado acaba sin nada.

boards le pregunta a auth a través del puerto `Workspaces` del [capítulo
4](./04-who-and-where), que recibe una pregunta más. En `member.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
export type Workspaces = {
  /** Whether someone belongs to a workspace now, deleted it has nobody: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
  /** Whether a workspace is still there: deleted, a worker has nothing to write in it. */
  exists(workspaceId: string): Promise<boolean>
}
```

El módulo de miembros se la pregunta a los demás, en `member.module.ts` después de
`isMember`:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
  /** Whether a workspace is still there: what a worker that writes in one asks first. */
  @UseCase()
  async exists(workspaceId: string): Promise<boolean> {
    return this.deps.workspaces.exists(workspaceId)
  }
```

### La regla de escritura, comprobada

`prepare` escribe en tres módulos que no son el suyo. El [capítulo
13](./13-another-context) explicó por qué eso solo puede pasar desde un worker: cada
módulo guarda en su propia transacción, y si una petición hiciera esto y fallara después
del tablero, la petición respondería un error y nada terminaría nunca el trabajo. Desde
un worker, el job se ejecuta otra vez hasta que se completa.

newt lo comprueba mientras se ejecutan los casos de uso. Un caso de uso de `board` que
guarda, llamado bajo un caso de uso de `workspace` fuera de un worker, lanza:

```text
[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo
```

y el guardado no ocurre. La salida que el mensaje ofrece en segundo lugar, `writesTo`, es
para la rara excepción justificada, dicha donde se ve (`card.removeColumn`, [capítulo
8](./08-two-people-one-card)). `prepare` no necesita ninguna: lo llama un worker.

A veces quieres hacer a mano lo que haría un worker: en un test, o en un script que
prepara workspaces creados antes de que existiera esta funcionalidad.
`base.jobs.runAsWorker(fn)` ejecuta `fn` como se ejecuta un job: en un worker, así que sus
casos de uso pueden escribir en cualquier módulo, y sin más actor ni scope que los que
fije él mismo.

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    await t.boards.base.jobs.runAsWorker(() => t.modules.workspace.prepare('acme'))
```

Lo que ejecutes así tiene que seguir siendo seguro de ejecutar otra vez: no recibe ningún
job, y nada lo ejecuta una segunda vez si falla.

## Purgar un workspace

`purge`, al final de `workspace.module.ts`, es la segunda saga. auth borró el workspace;
no va a volver, así que aquí nunca hay nada que deshacer. Cada paso solo tiene que
completarse. Las tarjetas van primero, luego las columnas, luego los tableros: si una
ejecución se parara a medias, lo que queda son tableros sin tarjetas ni columnas, nunca
una tarjeta en una columna que ya no existe.

Cada módulo borra sus propias filas, con un caso de uso propio. Todos se parecen. En
`card.module.ts`, después de `unassignMember`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** A workspace was deleted in auth: its cards go. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

En `column.module.ts`, después de `remove`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /** A workspace was deleted in auth: its columns go. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

En `board.module.ts`, después de `archive`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /**
   * A workspace was deleted in auth: its boards go, archived ones too. A step of that
   * deletion: a worker calls it, as many times as it takes, and the second
   * time finds nothing to remove.
   */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

### Borrar filas para siempre: `purge`

Hasta ahora las filas se iban de una entidad en una: se carga una tarjeta, se borra, se
guarda y emite `card.deleted`; un tablero se archiva, lo que marca `deletedAt` y conserva
su fila. Ninguna de las dos sirve aquí. Nadie necesita un `card.deleted` por cada tarjeta
de un workspace que ya no existe, y un tablero archivado suyo también tiene que irse:
esas filas nunca le dirán nada a nadie.

Un `TableRepository` borra filas para siempre con **`purge(criteria)`**. Borra todas las
filas que coinciden, en todos los scopes (el workspace se nombra, no es el actual: ya no
hay nadie en él), también las borradas de forma lógica (tableros archivados). No carga
ninguna entidad y no emite ningún evento. Escribe como `saveRows`: una transacción, bajo
la regla de escritura.

En `board.repository.ts`, después de `recentInEveryScope`:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
  /**
   * Removes every board of a workspace, archived ones too, for good: rows that will
   * tell nothing, so `purge` removes them. The workspace is named, not the current
   * one: auth deleted it, and nobody is in it.
   */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

En `column.repository.ts`, al final:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  /** Removes every column of a workspace for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

Las tarjetas tienen una segunda tabla, el contador de números de cada tablero ([capítulo
7](./07-cards-and-a-counter)). Las filas que no son de ninguna entidad se escriben con
**`saveRows(write)`**: una transacción alrededor de lo que haga `write`. Las tarjetas y
sus contadores se van juntos. En `card.repository.ts`, después de `persistOrder`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /** Removes every card of a workspace, and its boards' counters, for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.saveRows(async () => {
      await this.purge({ workspaceId })
      await this.counters.deleteMany({ workspaceId })
    })
  }
```

Ejecuta cualquiera de ellos por segunda vez y no queda nada que borrar. Nada falla.

### La actividad también se va

La actividad de cada tarjeta es del módulo de actividad, y este reacciona por su cuenta al
mismo evento. Su puerto solo necesita `deleted`, así que solo dice eso. Sustituye
`activity.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.deps.ts
import type { EventSource } from 'newt/core'
import type { Card_Module } from '../card/card.module'
import type { Member_Module } from '../member/member.module'

/** auth's event about workspaces the activity reacts to, as a port: auth's emitter fits it. */
export type WorkspaceDeletions = {
  deleted: EventSource<{ id: string }>
}

export interface Activity_Deps {
  /** What happens to the cards: what the log records. */
  card: Card_Module
  /** That who reads a card's activity belongs to its workspace (its routes). */
  member: Member_Module
  /** auth deleting a workspace: its log goes with it. */
  tenants: WorkspaceDeletions
}
```

`TenantEvents` también tiene `deleted`, así que el mismo objeto encaja en los dos puertos.
Añade el caso de uso a `activity.module.ts`, después de `recordDeleted`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
  /** A workspace was deleted in auth: its log goes. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }
```

el método de su repositorio, al final de `activity.repository.ts`:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.repository.ts
  /** Forgets every entry of a workspace: auth deleted it (see `Board_Repository.purgeWorkspace`). */
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.purge({ workspaceId })
  }
```

y la suscripción, en `activity.workers.ts`, después de los seis eventos de tarjeta:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
  // auth deleted a workspace: its log goes, like its boards (a job of auth's outbox).
  deps.tenants.deleted.subscribe(tenant => activity.purgeWorkspace(tenant.id), {
    strategy: 'handler',
    queue: 'activity.purgeWorkspace.on.tenant.deleted',
  })
```

## Los workers

Las dos reacciones del módulo de workspace. Crea `modules/workspace/workspace.workers.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

/**
 * boards follows auth's workspaces, a moment later: a new one gets its welcome board,
 * and a deleted one loses everything it had here. Each reaction is a job of auth's
 * worker, saved with the change that tells it, and run until it completes.
 */
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.purge.on.tenant.deleted',
    // The workspace is gone in auth already: a purge that keeps failing must not die soon.
    attempts: 10,
  })
}
```

Los dos son `handler`: jobs escritos en la transacción de auth, en el outbox de auth,
ejecutados por el worker de auth (capítulo 13). La purga recibe **`attempts: 10`** en
lugar de los cinco por defecto. Un job que se queda sin intentos está muerto ([capítulo
12](./12-failures)), y una purga muerta es una saga atascada a medias: un workspace que
auth borró y cuyos tableros siguen en boards, sin nada que lo termine. Diez intentos, con
una espera que crece entre ellos, dan tiempo a que un fallo pasajero (la base de datos
que se reinicia, un despliegue) desaparezca. Si aun así muere, el outbox lo lista:
alguien lo mira, arregla la causa y lo reintenta.

## Converger

Junta las piezas e imagina que `purge` falla después de las tarjetas, antes de las
columnas. Su job se ejecuta otra vez:

- `card.purgeWorkspace` borra las tarjetas del workspace. No hay ninguna. Bien.
- `column.purgeWorkspace` borra sus columnas.
- `board.purgeWorkspace` borra sus tableros.

El workspace acaba sin nada, como si no hubiera fallado nada. Eso es converger: se pare
donde se pare el trabajo, ejecutarlo otra vez lleva al mismo final. Hacen falta las dos
mitades:

- **Cada paso es seguro de ejecutar otra vez.** Escribe un resultado ("este workspace no
  tiene tarjetas"; "este tablero tiene estas columnas"), o encuentra lo que hizo una
  ejecución anterior.
- **El trabajo se ejecuta otra vez hasta que termina.** Cada saga es un job guardado con
  el evento que la inicia, y se reintenta cuando falla.

Quita cualquiera de las dos y el trabajo puede quedarse a medias para siempre. Un paso
que solo se ejecuta desde una petición se pierde si falla; un paso que no es seguro de
repetir se rompe en su reintento.

Las dos sagas de boards solo avanzan. Un flujo que otra cosa puede parar a medias (un
pedido cancelado después de reservar su stock) necesita, por cada paso hecho, una
**compensación**: otro paso, desde un worker, ante el evento que para el flujo, que lo
deshace, y que también es seguro de ejecutar otra vez, incluso si el paso que deshace
nunca se ejecutó. cooper no tiene ninguna.

## Un tablero como una pantalla

La ruta del módulo sirve `boardView`. Crea `modules/workspace/workspace.routes.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Workspace_Deps } from './workspace.deps'
import type { Workspace_Module } from './workspace.module'

export function registerWorkspaceRoutes(base: BoardsBase, workspaces: Workspace_Module, deps: Workspace_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/view', async request => Response.json(await workspaces.boardView(request.params.boardId)))
}
```

`GET /api/workspaces/:workspaceId/boards/:boardId/view` responde el tablero, sus columnas
y sus tarjetas juntos. Un tablero de otro workspace es un 404, como cualquier tablero.

## FakeAuth crea y borra workspaces

El auth falso emite los dos eventos nuevos, desde su store, como emite `access.revoked`.
Responde `exists` a partir de los workspaces en los que tiene miembros, da `tenants` para
el nuevo puerto, y muestra sus jobs, para que un test pueda ver cada uno terminado.
Sustituye `testing/fake-auth.ts`:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
import { SqliteStore } from 'newt/adapter-sqlite'
import { Email } from 'newt/contract'
import { eventsOf, now, type DomainEvent } from 'newt/core'
import { Base } from 'newt/runtime'
import type { AccessEvents } from '../modules/card/card.deps'
import type { Workspaces } from '../modules/member/member.deps'
import type { MemberDTO } from '../modules/member/member.schema'
import type { TenantEvents } from '../modules/workspace/workspace.deps'

class Tenant_Created implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.created'
  readonly name = Tenant_Created.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

class Tenant_Deleted implements DomainEvent<{ id: string }> {
  static readonly eventName = 'tenant.deleted'
  readonly name = Tenant_Deleted.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: { id: string }) {}
}

type Access = { userId: string, productId: string, tenantId: string | null }

class Access_Revoked implements DomainEvent<Access> {
  static readonly eventName = 'access.revoked'
  readonly name = Access_Revoked.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: Access) {}
}

/**
 * auth, as `boards`' tests need it: who belongs to each workspace, kept in memory, and
 * auth's events about workspaces and access, told as auth tells them. Each event is
 * published in a transaction of its own store, so boards' handlers are jobs of its
 * worker, as they are of auth's, and run only on `idle`.
 */
export class FakeAuth {

  private readonly members = new Map<string, Map<string, MemberDTO>>()

  /** The port of who belongs to each workspace. */
  readonly workspaces: Workspaces = {
    isMember: async (workspaceId, userId) => this.members.get(workspaceId)?.has(userId) ?? false,
    member: async (workspaceId, userId) => this.members.get(workspaceId)?.get(userId) ?? null,
    exists: async workspaceId => this.members.has(workspaceId),
  }

  readonly tenants: TenantEvents
  readonly access: AccessEvents

  private constructor(private readonly base: Base) {
    this.tenants = eventsOf(base.bus, { created: Tenant_Created, deleted: Tenant_Deleted })
    this.access = eventsOf(base.bus, { revoked: Access_Revoked })
  }

  static async open(): Promise<FakeAuth> {
    return new FakeAuth(new Base({ name: 'auth', store: await SqliteStore.open({ path: ':memory:' }) }))
  }

  /** Someone joins a workspace: `<userId>@cooper.test`, named after their id. */
  join(workspaceId: string, userId: string): MemberDTO {
    const member = { id: userId, name: userId, email: Email.from(`${userId}@cooper.test`) }
    const members = this.members.get(workspaceId) ?? new Map<string, MemberDTO>()
    members.set(userId, member)
    this.members.set(workspaceId, members)
    return member
  }

  /** A workspace is created, with its creator in it: `tenant.created`. */
  async createWorkspace(workspaceId: string, creatorId: string): Promise<void> {
    this.join(workspaceId, creatorId)
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /**
   * `tenant.created` told again, and nobody joins: as a job of it run late, after its
   * workspace is gone.
   */
  async tellCreatedAgain(workspaceId: string): Promise<void> {
    await this.tell(new Tenant_Created({ id: workspaceId }))
  }

  /** A workspace is deleted, and nobody belongs to it any more: `tenant.deleted`. */
  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.members.delete(workspaceId)
    await this.tell(new Tenant_Deleted({ id: workspaceId }))
  }

  /** Someone leaves a workspace: `access.revoked`. */
  async revoke(workspaceId: string, userId: string): Promise<void> {
    this.members.get(workspaceId)?.delete(userId)
    await this.tell(new Access_Revoked({ userId, productId: 'cooper', tenantId: workspaceId }))
  }

  /** Until the jobs of its events are done: boards' reactions. */
  idle(): Promise<void> {
    return this.base.jobs.idle()
  }

  /** The jobs of its events, as they stand: to see one that failed. */
  jobs() {
    return this.base.store.outbox.list()
  }

  close(): Promise<void> {
    return this.base.close()
  }

  private async tell(event: DomainEvent): Promise<void> {
    await this.base.store.transaction(() => this.base.bus.publish(event))
  }
}
```

- `createWorkspace` mete en él a su creador y emite `tenant.created`.
- `deleteWorkspace` quita a todos, así que `exists` dice que no, y emite
  `tenant.deleted`.
- `tellCreatedAgain` emite `tenant.created` sin que se una nadie: un job del evento que
  se ejecuta tarde, cuando su workspace ya se borró.
- `jobs()` lista el outbox de auth tal como está, con el estado de cada job.

## Conectarlo

`Boards_ModuleDeps` recibe `tenants`, y boards inicializa el módulo de workspace, después
de los módulos que usa, y entrega `tenants` también al módulo de actividad. Sustituye
`initialize-modules.ts`:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access), and a mailer. Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

El helper de tests entrega los `tenants` de FakeAuth, en `testing/open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
```

y el servidor de desarrollo también, en `index.ts`:

```ts
// cooper/backend/index.ts
const boards = await Boards_Context.open(config.boards, {
  workspaces: auth.workspaces,
  tenants: auth.tenants,
  access: auth.access,
```

El auth falso del servidor de desarrollo solo deja que la gente se una, como antes: ahí no
se crea ningún workspace, así que no recibe tablero de bienvenida. Eso lo ves en los
tests.

## Tests

Crea `modules/workspace/workspace.test.ts`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { WELCOME_BOARD } from './workspace.schema'

describe('workspace', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  /** The welcome board of acme, as its screen shows it: each column with its cards' titles. */
  const welcome = async () => {
    const boards = await inAcme(() => t.modules.board.list({ size: 10 }))
    const view = await inAcme(() => t.modules.workspace.boardView(boards.items[0]!.id))
    return {
      boards: boards.items.map(board => String(board.name)),
      columns: view.columns.map(column => [column.name, view.cards.filter(card => card.columnId === column.id).map(card => card.title)]),
    }
  }

  test('gives a new workspace its welcome board, a moment after auth creates it', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
    t.auth.join('acme', 'ana')
    // A first run that stopped halfway: the board and one column, their names in another case.
    const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
    await inAcme(() => t.modules.column.add(board.id, { name: 'TO DO' }))

    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['welcome'],
      columns: [['TO DO', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('prepares nothing in a workspace auth deleted before its work ran', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.deleteWorkspace('acme')
    await t.settled()

    // The work of `tenant.created`, run again late: after the workspace was purged.
    await t.auth.tellCreatedAgain('acme')
    await t.settled()

    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
  })

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

  test('gives a workspace one welcome board, however many runs start at once from nothing', async () => {
    await Promise.all([t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana')])
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done'])
  })

  test('refuses to prepare a workspace outside a worker, since it writes in other modules, and prepares it in one', async () => {
    t.auth.join('acme', 'ana')

    await expect(inAcme(() => t.modules.workspace.prepare('acme'))).rejects.toThrow('[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo')
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

    // What a script does by hand, as the worker of `tenant.created` would.
    await t.boards.base.jobs.runAsWorker(() => t.modules.workspace.prepare('acme'))
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
  })

  test('removes all a workspace has once auth deletes it, and nothing of any other', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.createWorkspace('globex', 'bea')
    await t.settled()

    await t.auth.deleteWorkspace('acme')
    await t.settled()

    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)

    // Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
    await t.auth.deleteWorkspace('acme')
    await t.settled()
    // Each deletion is heard twice: the workspace's purge, and its activity's.
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
  })

  test('leaves the cards of someone who left a workspace without an assignee', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    t.auth.join('acme', 'bea')
    await t.settled()
    const { columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const mine = await inAcme(() => t.modules.card.create(cards[0]!.boardId, { columnId: columns[1]!.id, title: 'Mine', assigneeId: 'ana' }))
    await inAcme(() => t.modules.card.assign(cards[0]!.id, { assigneeId: 'bea' }))

    await t.auth.revoke('acme', 'bea')
    await t.settled()

    expect((await inAcme(() => t.modules.card.get(cards[0]!.id))).assigneeId).toBeNull()
    expect((await inAcme(() => t.modules.card.get(mine.id))).assigneeId).toBe('ana')
  })

  test('takes a card left in a removed column to the first one, a moment later', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    const { board, columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const [todo, doing] = [columns[0]!, columns[1]!]
    await inAcme(() => t.modules.card.create(board.id, { columnId: doing.id, title: 'Already there' }))

    // As if a card were moved into it while it was being removed: the column goes with a card in it.
    await inAcme(() => t.modules.column.remove(todo.id))
    await t.settled()

    const view = await inAcme(() => t.modules.workspace.boardView(board.id))
    expect(view.columns.map(column => column.name)).toEqual(['Doing', 'Done'])
    expect(view.cards.map(card => [card.columnId, card.position, card.title])).toEqual([
      [doing.id, 0, 'Already there'],
      [doing.id, 1, cards[0]!.title],
    ])
  })
})
```

Qué muestra cada test:

- **El tablero de bienvenida, un momento después.** Justo después de que auth cree el
  workspace, boards no tiene ningún tablero: el trabajo aún no se ha ejecutado. Eso es
  consistencia eventual, y el test lo dice a propósito. Después de `settled()`, el
  tablero está ahí.
- **Una vez, y terminar uno dejado a medias.** El test representa una primera ejecución
  que se paró después del tablero (llamado `welcome`, en minúsculas) y una columna
  (*TO DO*, en mayúsculas). Dos ejecuciones más lo terminan: el tablero y la columna se
  encuentran sea cual sea su capitalización, se añaden *Doing* y *Done*, y la tarjeta
  una sola vez, en *TO DO*.
- **Nada en un workspace borrado antes de que su trabajo se ejecutara.**
  `tellCreatedAgain` hace que el job de `tenant.created` se ejecute después de la purga.
  `prepare` no encuentra el workspace y no escribe nada. `listOf` lee los tableros de un
  workspace con nombre, desde fuera de cualquiera.
- **Ejecuciones a la vez.** Tres ejecuciones sobre un tablero sin columnas, y tres desde
  cero: un tablero, tres columnas, una tarjeta, y todos los jobs `done`. Son los
  conflictos en acción: las ejecuciones que perdieron ejecutaron `prepare` otra vez y lo
  encontraron todo.
- **La regla de escritura, y `runAsWorker`.** `prepare` desde un test, como una persona de
  acme, se rechaza en su primera escritura, y no se guarda nada. Ejecutado como un worker,
  prepara el workspace.
- **Una purga que no toca ningún otro workspace**, ejecutada por segunda vez, como tras un
  fallo a medias: no queda nada, nada falla. Los seis jobs son los dos `prepare`, y, por
  cada uno de los dos borrados, la purga del workspace y la de su actividad.
- **Alguien que se fue**, y **una tarjeta en una columna borrada**: las dos reacciones del
  capítulo 13, ahora sobre un tablero de bienvenida. La segunda sustituye al test que
  añadiste a `card.test.ts` en el capítulo 13: borra ese, `takes a card left in a removed
  column to the first one of its board, a moment later`, de `card.test.ts`.

En `column.test.ts`, después del test que conserva la última columna de un tablero,
`addMissing` por sí solo:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('adds the columns a board is missing, by name whatever the case, and answers them in their order', async () => {
    const todo = await add('TO DO')

    const columns = await inAcme(() => t.modules.column.addMissing(boardId, ['Done', ' to do ', 'DONE', 'Doing']))

    expect(columns.map(column => column.name)).toEqual(['Done', 'TO DO', 'Done', 'Doing'])
    expect(columns[1]!.id).toBe(todo.id)
    expect(await names()).toEqual(['0:TO DO', '1:Done', '2:Doing'])
  })
```

El tablero tiene *TO DO*. Al pedirle `'Done'`, `' to do '`, `'DONE'` y `'Doing'`,
`addMissing` añade *Done* y *Doing* una vez cada una, encuentra *TO DO* para `' to do '`
(sin espacios, y comparado sea cual sea su capitalización), y responde cuatro columnas
en el orden pedido: *Done*, el *TO DO* del tablero (el mismo id), *Done* otra vez y
*Doing*.

En `boards.context.test.ts`, el test que guarda un tablero, sus columnas y sus tarjetas
ahora las lee a través de `/view`. Renómbralo y sustituye sus dos lecturas:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, its columns and its cards, and shows them as one screen', async () => {
// …
    const view = await call<{ board: { name: string }, columns: { name: string }[], cards: { title: string }[] }>('GET', `/acme/boards/${id}/view`)
    expect(view.body.board.name).toBe('Plans')
    expect(view.body.columns.map(column => column.name)).toEqual(['To do', 'Done'])
    expect(view.body.cards.map(each => each.title)).toEqual(['Plan'])
```

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Los tests del workspace por separado:

```sh
bun test cooper/backend/contexts/boards/modules/workspace
```

```text
 9 pass
 0 fail
 19 expect() calls
Ran 9 tests across 1 file.
```

Luego la pantalla de un tablero, a mano. Arranca el backend (`bun cooper/backend/index.ts`),
crea un tablero con dos columnas y una tarjeta, y pide su vista:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Screen $RANDOM\"}" | jq -r .id)
TODO=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"Done"}' > /dev/null
curl -s -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" > /dev/null
curl -s $API/boards/$BOARD/view -H 'x-user: ana' | jq '{board: .board.name, columns: [.columns[].name], cards: [.cards[] | {number, title, position}]}'
```

```json
{
  "board": "Screen 15634",
  "columns": [
    "To do",
    "Done"
  ],
  "cards": [
    {
      "number": 1,
      "title": "Plan",
      "position": 0
    }
  ]
}
```

El mismo tablero desde globex, donde está bea:

```sh
curl -s http://localhost:3002/api/workspaces/globex/boards/$BOARD/view -H 'x-user: bea'
```

```text
{"error":"There is no board 01a17956-fcec-7399-89dd-d9ce77f6fe34","code":"board.not_found"}
```

con estado 404 (tu id será distinto).

## En resumen

- Un trabajo sobre varios módulos es una saga: pasos, cada uno su propio guardado. Se
  ejecuta desde un worker, que lo ejecuta otra vez hasta que se completa; newt lo rechaza
  fuera de uno (la regla de escritura), y `base.jobs.runAsWorker` lo ejecuta como uno a
  mano.
- Cada paso encuentra lo que hizo una ejecución anterior antes de hacerlo, y su guardado
  comprueba otra vez, así que dos ejecuciones a la vez acaban en un conflicto y el primer
  caso de uso de la cadena se ejecuta otra vez. Una ejecución repetida converge en el
  mismo final.
- Un job puede ejecutarse tarde: pregunta si aquello en lo que trabaja sigue ahí, antes y
  después.
- Las filas que nunca dirán nada se van para siempre con `purge(criteria)` (todos los
  scopes, también las borradas de forma lógica, sin eventos), o con `saveRows` alrededor
  de varias tablas.
- Una saga que solo avanza no necesita compensación; dale más `attempts` a su job, porque
  uno muerto es trabajo atascado a medias.

Siguiente: [Consultas que una tabla no sabe decir: Kysely](./15-kysely).
