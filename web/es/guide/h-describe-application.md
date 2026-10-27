# H. Lo que una aplicación sabe de sí misma

newt-graph ([apéndice G](./g-command-line#newt-graph)) lee una aplicación de su código.
La aplicación puede decir mucho de lo mismo de sí misma, mientras corre: sus contextos y
los que usa cada uno, los módulos de cada uno, sus casos de uso, los eventos que cuentan
(las programaciones entre ellos), de qué depende cada módulo, y quién reacciona a qué
evento. Eso es **`describeApplication`**, de `newt/runtime`.

Pide una cosa a cada módulo, que los módulos de los capítulos todavía no hacen: que pase
sus deps a `super`. Este apéndice muestra ese cambio, y después lo que guarda la
descripción.

## Lo que registra cada contexto

La base de cada contexto guarda un **registro**, en sus `invocations`. Mientras el
contexto se abre, cada pieza le dice lo que es:

- **Un módulo**, al construirse: `super(…)` registra su nombre, su clase y sus deps.
- **Cada `@UseCase`** suyo, con su `writesTo` y su `retryOnConflict`
  ([capítulo 8](./08-two-people-one-card), [14](./14-sagas)).
- **Cada programación**, cuando `base.schedules.define` la define, con su cron
  ([capítulo 19](./19-invitations-and-time)).
- **Cada suscripción**, al hacerse: su evento, su estrategia, y para un handler su cola,
  sus intentos y si dice `when` ([capítulo 11](./11-reacting)).

Nada se lee del código: el registro guarda lo que se construyó, y nada más. Nunca lo
llamas tú. `describeApplication` lo lee.

## Un módulo pasa sus deps a `super`

Los módulos de los capítulos llaman a `super('board', base.invocations)`: newt conocía un
módulo por su nombre. Para saber de qué depende, el constructor de `Module` toma un
tercer argumento, las deps que recibió su `initialize`. `member` guarda sus deps, y las
pasa:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
  static initialize(base: BoardsBase, deps: Member_Deps): Member_Module {
    return new Member_Module(base, deps)
  }

  private constructor(base: BoardsBase, private readonly deps: Member_Deps) {
    super('member', base.invocations, deps)
  }
```

Las deps de `board` son solo para sus rutas (`member`, que las ejecuta en el ámbito del
workspace, [capítulo 4](./04-who-and-where)). Su constructor las recibe igualmente, solo
para pasarlas:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  static initialize(base: BoardsBase, deps: Board_Deps): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base), deps)
    registerBoardRoutes(base, module, deps)
    return module
  }

  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository, deps: Board_Deps) {
    super('board', base.invocations, deps)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }
```

- **Todas sus deps**, también las que solo usan sus rutas o sus workers: `activity` y el
  `metric` del backoffice reciben las suyas igual. Con lo que se configura un módulo, sus
  `<M>_Options` (un mailer, una URL), no es una dep, y no se pasa.
- **El módulo no guarda ninguna ahí.** `super` se las da al registro, que solo las mira.
- **Un módulo que no pasa ninguna sigue funcionando.** La descripción dice que no
  depende de nada, lo cual es falso, y nada te avisa. Todos los módulos de cooper pasan
  sus deps, y `bunx newt add module` escribe así el esqueleto
  ([apéndice G](./g-command-line)).

## `describeApplication`

`describeApplication(contexts)` toma los contextos abiertos (o sus bases) y devuelve una
**`ApplicationDescription`**. Un script tuyo en la raíz del repositorio, junto a
`cooper/`, que abre en memoria los contextos de cooper y pregunta:

```ts
// describe-cooper.ts
import { describeApplication } from 'newt/runtime'
import { config } from './cooper/backend/config'
import { openContexts, stopContexts } from './cooper/backend/open-contexts'

const contexts = await openContexts({
  ...config,
  auth: { ...config.auth, database: ':memory:' },
  boards: { ...config.boards, database: ':memory:' },
  backoffice: { ...config.backoffice, database: ':memory:' },
})
const application = describeApplication([...contexts.all])
for (const context of application.contexts) {
  console.log(`${context.name} uses [${context.uses.join(', ')}]: ${context.modules.length} modules, ${context.subscriptions.length} subscriptions`)
}
console.log(JSON.stringify(application.contexts[1]!.modules.find(module => module.name === 'board'), null, 2))
await stopContexts(contexts)
```

```sh
bun describe-cooper.ts
```

```text
auth uses []: 10 modules, 12 subscriptions
boards uses [auth]: 8 modules, 21 subscriptions
backoffice uses [auth, boards]: 7 modules, 0 subscriptions
{
  "id": "boards/board",
  "context": "boards",
  "name": "board",
  "className": "Board_Module",
  "useCases": [
    { "id": "boards/board.list", "name": "board.list", "writesTo": [], "retryOnConflict": true },
    …
    { "id": "boards/board.purgeWorkspace", "name": "board.purgeWorkspace", "writesTo": [], "retryOnConflict": true }
  ],
  "events": [
    { "id": "boards/board.created", "name": "board.created", "schedule": null },
    { "id": "boards/board.updated", "name": "board.updated", "schedule": null },
    { "id": "boards/board.archived", "name": "board.archived", "schedule": null }
  ],
  "deps": [
    { "name": "member", "kind": "module", "target": "boards/member" }
  ]
}
```

Los `uses` son los que dice `eslint.config.js` (auth ninguno, boards auth, el backoffice
los dos, [capítulo 20](./20-wiring-contexts)), sacados de las deps de los módulos. El
backoffice no tiene suscripciones: su `metric` reacciona a eventos de auth y de boards,
y cada una de esas suscripciones es del contexto del evento, porque sus jobs están en
el outbox de ese contexto ([capítulo 26](./26-dead-jobs-and-analytics)).

## Lo que guarda

| Tipo | Qué es |
|---|---|
| `ApplicationDescription` | `{ version: 1, contexts }`. Un campo solo se añade; `version` sube cuando uno cambia de significado. |
| `ContextDescription` | Un contexto: su `name`, los contextos que `uses`, sus `modules` y las `subscriptions` a sus eventos. |
| `ModuleDescription` | Un módulo: su `id`, `context`, `name`, `className`, `useCases`, `events` y `deps`. |
| `UseCaseDescription` | Un caso de uso: su `id`, su `name` (`card.create`), su `writesTo` y su `retryOnConflict`. |
| `EventDescription` | Un evento que cuenta un módulo: su `id`, su `name`, y su `schedule` (`{ cron }`), null en uno que no lo es. |
| `ModuleDependency` | Una de las deps de un módulo, por su clave: un `module`, los `events` de uno, o un `port`. |
| `SubscriptionDescription` | Una suscripción: su `event`, su `strategy`, y para un handler su `queue`, el caso de uso que nombra (`handler`), sus `attempts` y si la filtra un `when` (`filtered`). |

Los ids son los de newt-graph: el de un módulo es `boards/card`, el de un caso de uso
`boards/card.create`, el de un evento `boards/card.created`. Con cooper, los dos
coinciden.

Una dep es de uno de tres tipos:

- **`module`**: otro módulo, de su contexto o de otro. `board`, `column` y `member` de
  `card`, y el módulo de accesos de auth, `{ name: 'auth.access', kind: 'module',
  target: 'auth/access' }`.
- **`events`**: los eventos de un módulo entregados solos (`orders: order.events`), como
  se suscribe a ellos un worker: `{ kind: 'events', target: 'shop/order', events:
  ['order.placed'] }`. cooper entrega los módulos mismos, así que no tiene ninguno.
- **`port`**: cualquier otra cosa, un objeto en las palabras del propio módulo: un
  mailer, una búsqueda, un proveedor de pagos. De quién es la descripción no lo puede
  saber, así que su `target` es null. Por eso los módulos de otro contexto se entregan
  tal cual, nunca envueltos en un puerto de funciones
  ([capítulo 20](./20-wiring-contexts)): envuelta, la dependencia sería un puerto sin
  destino.

En un objeto de deps se mira dentro, con sus claves unidas: el `member` de boards
depende de `auth.access`, `auth.tenant` y `auth.user`.

## Que un monitor lo lea

`newt/monitor` sirve la descripción a quien monitoriza la aplicación, en un puerto
propio: `GET /v1/structure` es `describeApplication`, y `GET /v1/identity` dice qué
aplicación y qué proceso es (su nombre, la versión de newt, un id nuevo en cada
arranque, la máquina y cuándo arrancó). Solo lectura, y nunca los datos de la
aplicación.

```ts
// cooper/backend/index.ts
// What cooper is made of, for whoever monitors it: only with a key, on a port no domain points at.
if (config.monitor.key) {
  const nonces = config.monitor.redisUrl ? new RedisNonces({ url: config.monitor.redisUrl, prefix: 'cooper:monitor:nonce' }) : undefined
  const monitor = serveMonitor(contexts.all, { name: 'cooper', port: config.monitor.port, hostname: config.monitor.hostname, key: config.monitor.key, nonces })
  console.log(`monitor listening on ${monitor.url}`)
}
```

Solo responde a una petición firmada con una clave que comparten los dos lados, de 32
caracteres o más; sin ella no arranca. La clave nunca viaja: el monitor firma cada
petición con `signMonitorRequest` (HMAC-SHA256 de su método, su ruta, cuándo se hizo y
un nonce propio), y la aplicación comprueba la firma, que se hizo a menos de 30
segundos de ahora y que su nonce no se ha visto antes. Una petición vista por el camino
no sirve otra vez, ni para otra. Cualquier otra recibe un 401, el mismo sea cual sea el
fallo, y no aprende nada, ni siquiera qué rutas hay.

```ts
const url = 'http://cooper:3010/v1/structure'
const structure = await (await fetch(url, { headers: signMonitorRequest(key, { url }) })).json()
```

Deja su puerto fuera de internet: escucha en `127.0.0.1` (lo que hace por defecto) o,
en un contenedor, en `0.0.0.0` sin dirección pública delante del puerto, para que solo
lo alcancen los contenedores de su red. La imagen de cooper lo hace así: sus tres
contextos tienen un dominio cada uno; su monitor (`COOPER_MONITOR_KEY`, puerto 3010),
ninguno.

## Lo que no puede saber

- **Llamadas y rutas.** Sabe de qué depende un módulo, no qué caso de uso llama a cuál,
  ni sus rutas. Eso es de newt-graph, leído del código.
- **Un módulo que no pasó sus deps**, como se dijo arriba.
- **El módulo de un puerto.**

Y al revés, newt-graph no puede saber lo que se elige mientras la aplicación corre; la
descripción es lo que se construyó. Uno lee el código, la otra la aplicación que corre:
una página, un health check o un test pueden preguntar a la segunda sin leer una línea
del primero.
