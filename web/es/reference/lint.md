# Lint

`newt-eslint` es el lint de una aplicación hecha con newt: lo que mantiene todos los
módulos iguales, los escriba quien los escriba, y cada contexto dentro de sus
fronteras.

```bash
bun add -d newt-eslint eslint
```

## El preset

`newt(options)` da la configuración: sus reglas, el parser de TypeScript y los
ficheros que mira cada regla. Sus opciones son `contexts`, la carpeta de los contextos
y cuáles usa cada uno, y `files`, los globs de los ficheros que revisa (todos los
`.ts` por defecto). Para una aplicación con dos contextos en
`src/contexts`, `auth` y `shop` (que usa `auth`), su `eslint.config.js` podría ser este
(un ejemplo genérico; el de cooper está [más abajo](#en-cooper)):

```js
import { newt } from 'newt-eslint'

export default newt({
  contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } },
})
```

Un módulo es una carpeta dentro de una carpeta `modules/`, y su contexto es la carpeta
que contiene `modules/`. Así se encuentran tanto `src/contexts/shop/modules/order/`
como `app/modules/order/`. Una carpeta `modules/` en la raíz del proyecto tiene como
contexto el propio proyecto.

## En cooper

cooper tiene un único `eslint.config.js` en la raíz del repositorio. Su backend usa el
preset de newt, con sus tres contextos: `auth` no usa ninguno, `boards` usa `auth`, y
`backoffice` usa los dos.

```js
// eslint.config.js
import { newt } from 'newt-eslint'

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  // …
]
```

Por defecto el preset revisa todos los ficheros TypeScript del repositorio. `files` lo
limita al backend y sus scripts, porque el mismo fichero también revisa los frontends
de cooper con reglas propias (que aquí se omiten). Una aplicación que solo es un
backend no necesita `files`: `export default newt({ … })` es el fichero entero.

Se ejecuta con `bun run lint` (`eslint`).

## Las reglas

| Regla | Qué dice |
|---|---|
| `newt/module-anatomy` | Un módulo está hecho de los ficheros que tiene todo módulo, con su nombre: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, sus tests, y las carpetas `events`, `errors`, `value-objects` y `services`. El fichero de un evento es `<m>-<evento>.ts`. |
| `newt/module-boundaries` | Un módulo importa de otro solo su módulo, su esquema, sus eventos, sus errores y sus value objects: nunca su entidad, su repositorio, sus tablas, sus rutas ni sus workers, ni su carpeta (`../board`). |
| `newt/queue-name` | La cola de un handler es `<módulo>.<caso de uso>.on.<módulo>.<evento>`, como exige el framework al arrancar: en cualquier fichero de un módulo, la cola empieza por ese módulo, su callback llama a ese caso de uso del propio módulo (`this`, o un objeto que TypeScript dice que es un `<M>_Module`: `deps.cards`, con su nombre pero de otro tipo, no lo es; uno de ningún tipo que conozca, `any`, no se juzga; sin el programa que construye typescript-eslint, como hace el preset, un nombre con tipo `<M>_Module`, o uno con su nombre o su plural en inglés, `cards` para `card`, también como `this.cards` salvo que la clase dé otro tipo a ese campo), y termina en el evento al que se suscribe (`events.assigned` → `….assigned`). Un callback que no está escrito ahí ni es una función del fichero (`cards.notifyAssignee.bind(cards)`) no se revisa. |
| `newt/schema-imports` | El esquema de un módulo (`<m>.schema.ts`), que puede importar un frontend, toma de newt solo `newt/contract`: nunca `newt/core` ni ninguna otra entrada, que son del servidor (guardan ámbitos en `AsyncLocalStorage` y llegan a Bun), ni siquiera para un tipo. Solo se revisan los imports del propio esquema, no los de los ficheros que importa. |
| `newt/use-case` | Todo método público de un módulo es un caso de uso: en un `*.module.ts`, una clase que extiende `Module` marca con `@UseCase` cada método que ofrece (ni `private`, ni `protected`, ni `static`, ni el constructor, ni un getter). Uno sin marcar correría fuera de la regla de escritura, del reintento ante un conflicto y de la traza: se marca, o se hace `private` si solo lo llama el módulo. Una función en un campo público tampoco vale, porque no se puede marcar. Mira los `*.module.ts` estén donde estén, también los de un módulo compartido fuera de `modules/`. |
| `newt/route-body` | Una ruta pasa el cuerpo a un caso de uso tal como vino: en un `*.routes.ts`, `await request.json() as X` (o `<X>…`, o `const body: X = await request.json()`) dice que el cuerpo es un `X` antes de que nada lo compruebe, así que un caso de uso que olvidara parsearlo lo recibiría sin comprobar y el compilador no avisaría. El caso de uso lo recibe como `unknown` y lo parsea con su esquema de entrada; `as unknown`, o el `parse` de un esquema en la ruta, valen. Mira los `*.routes.ts` estén donde estén. |
| `newt/context-boundaries` | Con `contexts`: un contexto importa solo los que le da `uses`. `uses` enumera todos los contextos; uno que nombra un contexto desconocido, o un círculo, lanza un error al construir el preset, y una carpeta de contexto que no aparece no usa ningún otro. |

En cooper, `queue-name` lee así `card.workers.ts`: el fichero es del módulo `card`, el
callback llama a `cards.notifyAssignee` sobre un `Card_Module`, y el emisor es
`events.assigned`, así que la cola tiene que ser
`card.notifyAssignee.on.card.assigned`.

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
cards.events.assigned.subscribe(({ dto, by }, { id }) => cards.notifyAssignee(dto, by, id), {
  strategy: 'handler',
  queue: 'card.notifyAssignee.on.card.assigned',
})
```

Una suscripción que no es de ningún módulo, como una reacción propia de un test, no
tiene caso de uso que nombrar. Lo dice donde se lee, apagando la regla para esa línea:

```ts
// cooper/backend/contexts/backoffice/modules/job/job.test.ts
// A reaction to boards' cards that fails while the "mail server" is down, at its only attempt.
// It is the test's own, of no module: its queue names none.
let down = true
t.boards.modules.card.events.created.subscribe(() => {
  if (down) throw new Error('the mail server is down')
// eslint-disable-next-line newt/queue-name
}, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
```

Las dos reglas de fronteras miran adónde llega un import, se escriba como se escriba:
`import`, `export … from`, `import()`, `import x = require()` y `require()`; relativo,
con extensión (`./board.module.js`) o sin ella, o con un alias de los `paths` del
tsconfig (que las reglas leen del programa que construye typescript-eslint, como hace
el preset; sin él, solo se comprueban los imports relativos).

## Además de sus reglas

El preset también rechaza `transaction` dentro de un módulo, llamado o cogido
(`store.transaction(…)`, `store['transaction']`, `const { transaction } = store`): un
módulo escribe con `save` o `saveRows` de su repositorio. Y una promesa que se queda
sin `await` (`@typescript-eslint/no-floating-promises`, que necesita un
`tsconfig.json` que incluya todos los ficheros que revisa, o que haga referencia a un
proyecto que los incluya: el `tsconfig.json` raíz de cooper no tiene ficheros propios y
hace referencia a un proyecto por parte, `tsconfig.backend.json` para el backend,
`tsconfig.newt.json` para el framework).

Las reglas solas son `plugin`, para una configuración propia.

::: warning Cuidado
typescript-eslint aún no funciona con TypeScript 7: instala TypeScript 6 como
`typescript`, como hace el `package.json` raíz del repositorio:
`"typescript": "npm:@typescript/typescript6@6.0.2"`.
:::
