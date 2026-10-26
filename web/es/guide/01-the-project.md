# El proyecto

Antes del primer módulo, el proyecto que lo rodea: un solo workspace de Bun, el
framework importado por su nombre y tres comprobaciones que mantienen el código
honrado (tipos, lint y tests).

## Un solo paquete, en la raíz

cooper no tiene `package.json` propio. Todo el repositorio es un workspace de Bun, con
todas las dependencias en el `package.json` de la raíz, en versión exacta:

```json
// package.json
{
  "name": "newt-workspace",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "typecheck": "bun check",
    "test": "bun test",
    "lint": "eslint",
    "cooper": "bun run cooper/scripts/dev.ts --watch",
    "cooper:seed": "bun run cooper/scripts/seed.ts",
    // …
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.1",
    "kysely": "0.29.6",
    "zod": "4.3.6",
    // …
  },
  // …
}
```

El backend necesita poco: `zod`, con el que se describen todos los datos, y `kysely`
para las consultas que una tabla no sabe expresar (capítulo
[22](./22-backoffice)). El SDK de MCP es para el servidor MCP de `boards`.

Necesitas Bun 1.4 o posterior. newt solo funciona con Bun: sus stores están hechos
sobre `bun:sqlite` y `Bun.SQL`, y su servidor sobre `Bun.serve`.

## newt, por su nombre

En tu propio proyecto harías `bun add newt zod`. En este repositorio el framework está
al lado, en `packages/newt`, y aun así cooper lo importa por su nombre, igual que lo
haría una aplicación que lo hubiera instalado:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
```

Lo que hace que `newt/runtime` acabe en `packages/newt/runtime/index.ts` es un alias
del `tsconfig.json` de la raíz, que Bun lee para resolver los imports:

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "newt/*": ["./packages/newt/*/index.ts"],
      // …
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

El repositorio son tres proyectos de TypeScript: lo que corre en el servidor, lo que
corre en el navegador y los scripts. El del backend es TypeScript normal para Bun,
estricto y sin el DOM:

```json
// tsconfig.backend.json
{
  // What runs on the server, on Bun: the framework and cooper's backend. No DOM.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": { "newt/*": ["./packages/newt/*/index.ts"] }
  },
  "include": ["packages/**/*.ts", "cooper/backend/**/*.ts"],
  "exclude": ["**/node_modules"]
}
```

::: warning Cuidado
newt usa los decoradores estándar de TypeScript (`@UseCase()`). **No** actives
`experimentalDecorators`: pasa TypeScript a los decoradores antiguos, no estándar, que
no son para los que está escrito newt.
:::

## Las puertas del framework

newt se importa por estas rutas, y por ninguna más:

| Import | Para qué |
|---|---|
| `newt/core` | Lo esencial: módulos, entidades, casos de uso, eventos, errores, el actor, ámbitos, criterios, filtros, value objects. |
| `newt/repository` | Los repositorios: donde un módulo lee y guarda sus entidades. |
| `newt/runtime` | Un contexto en marcha: `Base`, `BoundedContext`. |
| `newt/http` | El router HTTP y el servidor. |
| `newt/adapter-sqlite` | El store de SQLite, el de cooper. |
| `newt/adapter-files`, `newt/adapter-postgres`, `newt/adapter-mysql` | Los otros stores. |
| `newt/kysely` | Consultas propias con Kysely, sobre un store SQL. |
| `newt/port-store`, `newt/port-outbox`, `newt/port-analytics` | Los puertos: lo que implementa un store, un outbox o un adaptador de analítica. |
| `newt/sql`, `newt/port-store/contract`, `newt/port-analytics/contract` | Para quien escriba un adaptador. |

El backend de cooper usa `newt/core`, `newt/repository`, `newt/runtime`, `newt/http`,
`newt/adapter-sqlite` y `newt/kysely`. El resto son para otros stores y para quien
escriba un adaptador.

## Comprobar los tipos

```bash
bun run typecheck
```

Ejecuta `bun check`, que sigue los tres proyectos del `tsconfig.json` de la raíz y
avisa de lo mismo que avisaría `tsc`:

```
✓ No type errors in 1,088 files across 3 projects
```

Mantenlo limpio. newt se apoya en el compilador más que la mayoría de frameworks: la
entrada y la salida de un caso de uso, el payload de un evento, los campos de un
criterio y los parámetros de una ruta tienen tipo, y un error ahí es un error de tipos
antes que un bug.

## Lint: newt-eslint

El compilador comprueba tipos. No puede comprobar que un módulo esté montado como
todos los demás, ni que un contexto no se meta en otro. Para eso está `newt-eslint`.
El `eslint.config.js` de cooper aplica su preset al backend y a los scripts, y le dice
qué contexto puede usar a cuál:

```js
// eslint.config.js
import { newt } from 'newt-eslint'
// …
const BACKEND = newt({
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
// …
export default [
  { ignores: ['packages/**', 'docs/**', 'web/**', '**/dist/**'] },
  ...within(['cooper/backend', 'cooper/scripts'], BACKEND),
  // … the frontend's own rules
]
```

`uses` es la forma de la aplicación: `auth` no usa ninguno, `boards` usa `auth` y
`backoffice` usa los dos. Un ciclo, o un contexto que no conoce, es un error en cuanto
arranca el lint.

Estas son las reglas:

| Regla | Qué dice |
|---|---|
| `newt/module-anatomy` | Un módulo se compone de los ficheros que tiene todo módulo, con su nombre: `<m>.module.ts`, `<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`, `<m>.deps.ts`, `<m>-options.ts`, sus tests, y las carpetas `events`, `errors`, `value-objects` y `services`. |
| `newt/module-boundaries` | De otro módulo solo se importa su módulo, su esquema, sus eventos, sus errores y sus value objects: nunca su entidad, su repositorio, sus rutas ni sus workers. |
| `newt/queue-name` | La cola de un worker se llama `<módulo>.<caso de uso>.on.<módulo>.<evento>` (capítulo [11](./11-reacting)). |
| `newt/context-boundaries` | Un contexto importa solo los contextos que le da `uses`. |

El preset rechaza además `store.transaction` dentro de un módulo (un módulo guarda a
través de su repositorio, capítulo [6](./06-transactions)) y una promesa sin `await`.

```bash
bun run lint
```

Prueba a romper una regla para ver qué dice. Un fichero de `auth` que importa el
backoffice:

```
cooper/backend/contexts/auth/zz-lint.ts
  1:36  error  '../backoffice/backoffice.context' is the context backoffice's, and auth uses no other context: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

Y un fichero del módulo `card` que echa mano del repositorio de `board`:

```
cooper/backend/contexts/boards/modules/card/zz.ts
  1:1   error  'zz.ts' is not a file a module has: its files are card.module.ts, card.ts, card.schema.ts, card.repository.ts, card.routes.ts, card.workers.ts, card.deps.ts, card-options.ts and *.test.ts  newt/module-anatomy
  1:34  error  '../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects                     newt/module-boundaries
```

::: tip Consejo
typescript-eslint todavía no funciona con TypeScript 7. El `package.json` de la raíz
instala TypeScript 6 como `typescript`:
`"typescript": "npm:@typescript/typescript6@6.0.2"`.
:::

## Tests

```bash
bun test
```

Bun encuentra cada `*.test.ts` y lo ejecuta. Los tests de cooper abren los contextos de
verdad, con SQLite en memoria, y los usan como lo haría una ruta, un worker o un
script: sin mocks del framework. Escribirás el primero al final del capítulo
[3](./03-first-module), y el capítulo [25](./25-tests) trata de ellos.

Para ejecutar los tests de un contexto, dale su carpeta:

```bash
bun test cooper/backend/contexts/boards
```

```
 33 pass
 0 fail
 95 expect() calls
Ran 33 tests across 5 files.
```

## Dónde va cada cosa

Todo lo de un contexto vive en su carpeta, y cada módulo en una carpeta propia dentro
de `modules/`, siempre con los mismos ficheros:

```
cooper/backend/contexts/boards/modules/board/
  board.schema.ts          el contrato: qué entra y qué sale
  board.ts                 la entidad
  value-objects/           valores con reglas propias
  events/                  lo que puede pasar
  errors/                  lo que puede salir mal
  board.repository.ts      cómo se guarda
  board.deps.ts            los módulos que usa
  board.module.ts          sus casos de uso
  board.routes.ts          su API HTTP
  board.test.ts            sus tests
```

El lint conoce estos nombres. El siguiente capítulo construye el contexto que los
contiene, y el capítulo [3](./03-first-module) escribe cada fichero de `board`.

## En resumen

- Un solo `package.json` en la raíz, con versiones exactas; cooper no tiene uno propio.
- newt se importa por su nombre (`newt/core`…), gracias a los `paths` del
  `tsconfig.json` de la raíz. Decoradores estándar: nunca `experimentalDecorators`.
- `bun run typecheck`, `bun run lint` y `bun test` tienen que quedar limpios.
- newt-eslint mantiene todos los módulos con la misma forma, impide que un módulo se
  meta en las tripas de otro y limita cada contexto a los que dice que usa (`uses`).
