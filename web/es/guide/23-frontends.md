# Los frontends y newt/contract

El backend de cooper hace todo lo que una persona necesita: Ana se registra en auth, crea
Acme, inicia sesión en boards y guarda sus tarjetas. Pero lo hace todo con `curl`. Desde el
[capítulo 22](./22-web-session), boards manda su navegador al `/oauth/authorize` de auth, y
auth lo manda a páginas que todavía no tiene: un formulario de inicio de sesión y la página
donde ella le dice que sí a boards.

Este capítulo da a cooper sus dos apps web: la de **auth** (iniciar sesión, registrarse,
aprobar una aplicación) y la de **boards** (el SaaS: workspaces, tableros, tarjetas,
búsqueda, ajustes). Son apps de React construidas con los dos paquetes de frontend de newt,
y Bun las construye y las sirve. El tutorial va del backend, así que copias las apps del
repositorio en vez de escribirlas. Lo que enseña este capítulo es dónde tocan el backend y
newt:

- **`newt/contract`**, la parte de newt que un navegador puede cargar, y por qué está
  aparte de `newt/core`;
- la regla que impide que el frontend importe el código del backend, mientras comparte su
  **contrato**, los `*.schema.ts` de los módulos;
- cómo cada contexto sirve su propia app, en su propio puerto: desde su código fuente en
  desarrollo, construida en producción;
- los scripts `cooper` y `cooper:build`, un proyecto de TypeScript para el navegador y la
  mitad del lint que toca al frontend.

## Qué copias

Las apps, sus librerías y los dos scripts vienen del tag:

```sh
git checkout tutorial/23 -- cooper/frontend cooper/libs cooper/scripts/dev.ts cooper/scripts/build.ts
```

```
cooper/
  frontend/
    auth/                  la app de auth: index.html, app.css, main.tsx, app.routes.tsx, pages/, services/, public/
    boards/                la app de boards: la misma forma, con modules/ para sus zonas
  libs/
    api/                   @cooper/api: los clientes de la API, el único camino al backend
    ui/                    @cooper/ui: los componentes propios de cooper (el tablero, el contador, el logo)
  scripts/
    dev.ts                 bun run cooper: el backend, sirviendo las apps desde su código fuente
    build.ts               bun run cooper:build: las apps, construidas
```

No hay nada que instalar. El `package.json` de la raíz tiene desde el capítulo 0 lo que
las apps necesitan: los paquetes de frontend de newt, `newt-react` y `newt-react-ui`, y
aquello sobre lo que se construyen (React, React Router, Radix, Tailwind y
`bun-plugin-tailwind`).

El resto del capítulo se escribe a mano: el backend aprende a servir las apps, y los
scripts del `package.json` de la raíz, los `tsconfig*.json` y `eslint.config.js` crecen.
Los archivos que trajo el checkout y que tocan el backend o newt se muestran más abajo,
para que sepas qué hacen.

## Las apps

Las apps se hacen con `newt-react-ui` (los componentes, y el lint que impide que una app
les dé estilo) y `newt-react` (estado, formularios, listas y las peticiones a una API de
newt). Esta guía no las enseña: lo hace el `AGENTS.md` de cada paquete, para quien
escriba un frontend. Lo que importa aquí es dónde tocan las apps el backend: el contrato
que comparten con él y cómo cada contexto sirve su app.

## newt/contract: lo que un navegador puede cargar

Desde el [capítulo 2](./02-first-module), tus esquemas y objetos de valor importan
`ValueObject` y `ValidationError` de `newt/contract`, no de `newt/core`. Este es el
motivo.

`newt/core` es lo que corre un backend. Entre sus piezas está el scope en que se ejecuta un
caso de uso: quién actúa, en qué workspace, con qué reloj, dentro de qué transacción. newt
lo guarda en un `AsyncLocalStorage`, de `node:async_hooks`, y `newt/core` lo crea al
cargarse el módulo. Un navegador no tiene `node:async_hooks`. Bun, al construir una app
para el navegador, pone en su lugar un sustituto vacío sin decir nada, y la página se rompe
en cuanto carga `newt/core`.

`newt/contract` es la parte de `newt/core` que no guarda ningún scope: los archivos que
corren en cualquier sitio, reexportados. Es lo que comparten un backend y sus clientes:

| Export | Qué es |
|---|---|
| `ValueObject`, `Email`, `SecretToken` | Objetos de valor, con sus esquemas, y los errores que lanzan (`InvalidEmail`, `InvalidSecretToken`). |
| `DomainError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError` | Las bases de todo error de dominio, así que un objeto de valor creado en el navegador lanza el mismo error que en el servidor. |
| `defineFilter`, `Filter`, `FilterField`, `FilterNode`, `FilterLimits` | Los filtros que un cliente puede enviar ([capítulo 15](./15-kysely)). |
| `Page`, `PageRequest` | Una página de una lista, y qué página pedir ([capítulo 3](./03-pages-and-errors)). |
| `ErrorBody` | El cuerpo de toda petición fallida: `error`, `code`, `issues`. |

Son las mismas clases y tipos que exporta `newt/core`; `newt/contract` es otra puerta a
ellos, no una copia. Un archivo que solo importa `newt/contract` (y zod) puede ir tal cual
al navegador. `newt-react` no importa nada más de newt.

## El esquema es el contrato

El `*.schema.ts` de un módulo dice qué entra en sus casos de uso y qué sale. Es el único
archivo del backend que un cliente necesita, así que es el único que un cliente puede
importar. Para que eso funcione, un archivo de esquema importa solo:

- `zod`;
- `newt/contract`;
- los objetos de valor de su propio módulo (que importan `newt/contract`) y los esquemas de
  otros módulos;
- tipos, con `import type`, de cualquier sitio salvo las otras entradas de newt: se
  borran antes de que el navegador vea el archivo. `card.schema.ts` importa así el tipo
  `ActorVia` de `shared/actor.ts`.

Los clientes lo usan de dos maneras. Sobre todo como tipos: `CardDTO`, `CardCreateDTO`,
`Page<CardDTO>`. Un cliente y su servidor no pueden discrepar sobre el nombre de un campo,
porque solo hay una declaración. A veces como valores, para que un formulario compruebe lo
que alguien escribe con las mismas reglas que comprueba el backend. El formulario de
registro de auth valida con `UserSignUpSchema`, de `auth/modules/user/user.schema.ts` (que
trae consigo `Email` y `defineFilter`, ambos de `newt/contract`), así que "Use at least 8
characters" aparece bajo el campo de la contraseña antes de enviar nada, y el backend dice
lo mismo si una petición se salta el formulario.

Cada carpeta de `@cooper/api` reexporta el contrato de su módulo junto a su cliente. Este
es el de card:

```ts
// cooper/libs/api/card/index.ts
// The contract comes from the backend module; the client is ours.
export type {
  CardAssignDTO,
  CardCreateDTO,
  CardDTO,
  CardEditDTO,
  CardFilterDTO,
  CardMoveDTO,
  CardSearchDTO,
} from '../../../backend/contexts/boards/modules/card/card.schema'
export * from './card.api'
```

Nada en el frontend importa un caso de uso, una entidad ni un repositorio, y el lint se
encarga de que así sea (más abajo): el frontend nunca importa `backend/`; `@cooper/api`
puede importar `backend/contexts/<context>/modules/<module>/<module>.schema.ts` y nada
más. Unas pocas carpetas tienen un `*.contract.ts` propio. Los workspaces, sus miembros y
sus invitaciones son los tenants y los accesos de auth, que las rutas de boards sirven con
las formas del `workspace.schema.ts` de boards: `workspace.contract.ts`,
`workspace-member.contract.ts` e `invitation.contract.ts` reexportan esas formas
(renombradas donde la app las llama de otro modo) y añaden solo lo que alguien escribe,
como el nombre de un workspace. La sesión web no tiene módulo (sus rutas viven en
`shared/web-session`), así que `web-session.contract.ts` escribe su contrato en zod llano.

## Un puerto por contexto: páginas y API

Hay una dirección por contexto, y el navegador solo habla con ella: auth en 3001, boards
en 3002, y en producción cada uno en su propio dominio. El contexto responde su API bajo
`/api` (y auth sus endpoints de OAuth) y entrega la página de su app a toda otra
dirección. Así, la app llama a `/api/workspaces/acme/cards/...` en su propio origen, la
cookie de sesión de boards se fija en el origen en que está la página, y una redirección
que boards construye desde su URL pública (`/api/session/callback`) cae en el propio
boards. Por eso las URLs públicas de `config.ts` son los puertos de los propios contextos
(`http://localhost:3001`, `http://localhost:3002`) desde que las escribiste: no hay nada
delante.

Lo que cambia es de dónde viene la app: construida, de una carpeta; en desarrollo, de su
código fuente.

## Construida: cada contexto sirve su carpeta

Añade a `config.ts` dónde encuentra cada contexto su build, al final de `auth`:

```ts
// cooper/backend/config.ts
    /** `COOPER_AUTH_FRONTEND`: its built frontend (`bun run cooper:build`). */
    frontendFolder: fromRoot(env.COOPER_AUTH_FRONTEND ?? 'dist/cooper/auth'),
  },
```

y al final de `boards`:

```ts
// cooper/backend/config.ts
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
```

y cambia el comentario sobre `config` para que lo diga:

```ts
// cooper/backend/config.ts
/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives,
 * where people open it and the built frontend it serves.
 */
```

`ServedContext` toma la carpeta en su config y se la pasa a `serve` como `frontend`:

```ts
// cooper/backend/shared/served-context.ts
import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** What its server answers besides its modules' API: OAuth's endpoints, an MCP entry. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds, its health, and its frontend for any other address. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, health: true }
  }
}
```

`Auth_Context` y `Boards_Context` ya pasan `config.auth` y `config.boards` a `super`, así
que no necesitan cambios. El contexto de test del [capítulo 22](./22-web-session) construye
su config a mano, así que también da una, en `web-session.test.ts`:

```ts
// cooper/backend/shared/web-session/web-session.test.ts
  private constructor(base: CooperBase, readonly session: WebSession_Module, port: number) {
    super('client', base, { port, frontendFolder: config.boards.frontendFolder })
  }
```

Lo que te da `frontend`, de `newt/http`:

- **Toda dirección que ninguna ruta toma.** El router tiene `/api`; los `routes()` del
  contexto (los `/oauth/*` y `/.well-known/*` de auth) y `health` van antes que el frontend
  también. Todo lo demás es del frontend.
- **Un archivo, o `index.html`.** Una ruta que nombra un archivo de la carpeta recibe el
  archivo (`/main-….js`, `/cooper.svg`); cualquier otra recibe `index.html`, así que
  `/w/acme/boards` abre la app y React Router muestra el tablero (o su propio "no
  encontrado"). Una ruta que sale de la carpeta no nombra ningún archivo.
- **Nunca bajo `/api`.** Una ruta bajo `/api` que ninguna ruta toma es un 404 con un
  `ErrorBody` (`route_not_found`), nunca la página de la app: un cliente que llama a una
  dirección equivocada recibe un error que puede leer, no HTML.
- **Páginas que se niegan a enmarcarse.** `index.html` y todo otro archivo HTML salen con
  `X-Frame-Options: DENY` y `frame-ancestors 'none'`: nadie puede mostrar la página de
  aprobación de auth dentro de la suya y robar el clic.
- **Una respuesta clara antes del build.** Si la carpeta no tiene `index.html`, las
  páginas responden `503 The frontend is not built: its folder has no index.html`. La API
  funciona igual, y por eso los tests no necesitan build.

## En desarrollo: desde su código fuente

En desarrollo nadie quiere construir tras cada cambio. `frontend` también acepta el
`index.html` de una app importado (`import app from './index.html'`): Bun lo construye
mientras lo sirve, con todo lo que nombra, y recarga la página cuando cambian sus
archivos. El `bunfig.toml` de la raíz, que está desde el capítulo 0, da Tailwind a ese
build:

```toml
# Bun's bundler builds HTML with Tailwind: the gallery of newt-react-ui, and the apps that serve their pages with Bun.
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

Importar un `index.html` empieza ese build, así que producción no debe hacerlo. Añade el
ajuste que lo pide, al final de `config`:

```ts
// cooper/backend/config.ts
// …
  /**
   * `COOPER_FRONTEND_SOURCES=1` (`bun run cooper` sets it): each context serves its
   * frontend from its sources, which Bun builds as it serves them and reloads as they
   * change, instead of its built folder.
   */
  frontendSources: env.COOPER_FRONTEND_SOURCES === '1',
}
```

Crea `cooper/backend/frontend-sources.ts`, que importa cada app solo cuando se le llama:

```ts
// cooper/backend/frontend-sources.ts
import type { HTMLBundle } from 'bun'

/**
 * Each context's frontend from its sources, for development (`bun run cooper`): every
 * context serves its pages beside its API, on its own port, as it will once built, and
 * Bun reloads them as they change. Imported only when asked for, so production never
 * builds them as it starts.
 */
export async function frontendSources(): Promise<Record<string, { frontend: HTMLBundle }>> {
  const [auth, boards] = await Promise.all([
    import('../frontend/auth/index.html'),
    import('../frontend/boards/index.html'),
  ])
  return { auth: { frontend: auth.default }, boards: { frontend: boards.default } }
}
```

Y en `index.ts`, da a cada contexto su app cuando el ajuste lo pide. Reemplaza el
archivo:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { frontendSources } from './frontend-sources'
import { openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// In development each context serves its frontend from its sources, as Bun builds them.
const sources = config.frontendSources ? await frontendSources() : null

const app = runContexts(contexts.all.map(context => ({
  context,
  serve: { ...context.serving(), ...(sources?.[context.name] ? { ...sources[context.name], development: true } : {}) },
})))
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

Lo que da el `serving()` de un contexto se queda como está; `frontend` se sustituye por el
código fuente de la app, y `development: true` activa el modo de desarrollo de Bun: sus
recargas, y su página de error, que muestra el código fuente, para lo que lanza fuera de
una ruta.

## Los scripts: cooper y cooper:build

Añade dos scripts al `package.json` de la raíz, alrededor de `cooper:seed`:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:build": "bun cooper/scripts/build.ts"
```

`cooper:build` ejecuta el script que trajo el checkout. Construye cada app con
`Bun.build`, desde su `index.html`, con Tailwind, en la carpeta que `frontendFolder`
nombra por defecto:

```ts
// cooper/scripts/build.ts
// bun run cooper:build: each frontend built by Bun, with Tailwind, into dist/cooper/<app>:
// the folder its context serves in production. What its index.html names (its icon, its
// styles, its script) is built with it.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import tailwind from 'bun-plugin-tailwind'

const ROOT = join(import.meta.dir, '../..')
const APPS = ['auth', 'boards'] as const

for (const app of APPS) {
  const source = join(ROOT, 'cooper/frontend', app)
  const out = join(ROOT, 'dist/cooper', app)
  await rm(out, { recursive: true, force: true })
  const built = await Bun.build({
    entrypoints: [join(source, 'index.html')],
    outdir: out,
    plugins: [tailwind],
    minify: true,
    // From the root: the app's router serves index.html at every address, however deep.
    publicPath: '/',
    // Fonts as files of their own, fetched when a page needs them, not inside the stylesheet.
    loader: { '.woff': 'file', '.woff2': 'file' },
    sourcemap: 'linked',
    target: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })
  if (!built.success) {
    for (const log of built.logs) console.error(log)
    process.exit(1)
  }
  console.log(`${app}: ${built.outputs.length} files in dist/cooper/${app}`)
}
```

`cooper` arranca cooper en desarrollo con el otro script: un proceso, el backend con
`COOPER_FRONTEND_SOURCES=1`, que `--watch` reinicia en cada cambio suyo (las apps se
recargan solas). La parte que dice qué arranca:

```ts
// cooper/scripts/dev.ts
// bun run cooper: cooper in development, and stops it all together. One process, the
// backend: every context on its port, each serving its API and its frontend from its
// sources, which Bun builds as it serves them and reloads as they change. With --watch
// the backend restarts on every change of its own. It runs in its own process group, so
// stopping it also stops what it spawns. The ports are fixed (it fails instead of moving
// to another one), so the links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

const SERVICES = [
  {
    name: 'backend',
    url: `http://localhost:${config.auth.port}/api/health`,
    cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'],
    env: { ...process.env, COOPER_FRONTEND_SOURCES: '1' },
  },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = (['auth', 'boards'] as const).map(name => ({ name, port: config[name].port }))
// …
```

Antes de arrancar nada comprueba que los puertos de los contextos están libres: `bun
--watch` sigue vivo tras fallar al escuchar, así que un puerto ocupado pasaría
desapercibido. El backend corre en un grupo de procesos propio, así que Ctrl+C también
detiene lo que lanzó; lo que ignore el `SIGINT` recibe un `SIGTERM` tres segundos después.
Cuando responde, el script imprime dónde vive cada contexto.

## TypeScript: un proyecto para el navegador

El proyecto del backend no tiene DOM, y no debe tenerlo: un archivo del backend que tocara
`window` compilaría y fallaría en ejecución. Las apps necesitan el DOM y JSX, así que
tienen un proyecto propio. Crea `tsconfig.frontend.json` en la raíz:

```json
{
  // What runs in the browser: cooper's frontends, their UI library and their API
  // clients, with the backend's contracts (its modules' *.schema.ts) they share.
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"]
    }
  },
  "include": [
    "cooper/frontend/**/*.ts",
    "cooper/frontend/**/*.tsx",
    "cooper/libs/**/*.ts",
    "cooper/libs/**/*.tsx",
    "cooper/backend/contexts/*/modules/*/*.schema.ts"
  ],
  "exclude": ["**/node_modules"]
}
```

Fíjate en el último `include`: los esquemas de los módulos se comprueban también en este
proyecto, con los tipos del navegador, además de en el del backend. `bun` sigue en `types`
porque los tests de los clientes corren con `bun test`.

El `tsconfig.json` de la raíz lo referencia, y recibe los `paths`, porque Bun resuelve los
imports (en `bun test`, y al construir las apps) con el archivo de la raíz:

```json
{
  // The whole repository, as eight projects: the framework (newt), its graph (newt-graph), its
  // monitor (newt-monitor), its React frontend's components and logic (newt-react-ui,
  // newt-react), what runs on the server (cooper's backend), what runs in the browser
  // (cooper's frontends and their libraries), and the tools around them (scripts). `bun check` follows the references.
  // The paths are here too because Bun resolves imports with this file. newt is not among
  // them: it is a workspace package, reached through its `exports` as any application reaches it.
  "compilerOptions": {
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.newt-graph.json" },
    { "path": "./tsconfig.newt-monitor.json" },
    { "path": "./tsconfig.newt-react-ui.json" },
    { "path": "./tsconfig.newt-react.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

## Lint: la mitad del frontend

`newt-eslint` hace el lint del backend. Los frontends reciben el preset propio de
`newt-react-ui`, `newtReactUi`, en el mismo `eslint.config.js`. Reemplázalo:

```js
import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'
import { newtReactUi } from 'newt-react-ui/lint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends newt-react-ui's. The framework's own code is not
// an application, so it is left out; newt-monitor is one, so it is in.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})

// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/src/contexts', uses: { monitor: [] } },
})

// newt-react-ui's gallery is an app like any other: it keeps the library's lint.
const UI_GALLERY = newtReactUi({ files: ['packages/newt-react-ui/gallery/**/*.{ts,tsx}'] })

// The frontend reaches the backend only through @cooper/api, the API clients.
const BACKEND_IMPORTS = {
  regex: '(^|/)backend(/|$)',
  message: 'The frontend never imports the backend: use the client in @cooper/api.',
}

// The API clients share the backend's contract, never its code: a module's schema file
// is the only thing they may import from the backend.
const API_BACKEND_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$)|$)',
  message: '@cooper/api may only import a backend module\'s *.schema.ts (its contract).',
}

// cooper's frontends compose newt-react-ui's components and style nothing: only cooper's
// own components (cooper/libs/ui, each app's components/) style, wrapping the library's.
const FRONTEND = newtReactUi({
  files: ['cooper/frontend/**/*.{ts,tsx}'],
  components: ['cooper/libs/ui/**', 'cooper/frontend/*/components/**'],
  imports: [BACKEND_IMPORTS],
})

export default [
  { ignores: ['packages/newt/**', 'packages/newt-eslint/**', 'packages/newt-graph/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  ...MONITOR,
  ...UI_GALLERY,
  ...FRONTEND,
  {
    files: ['cooper/libs/api/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [API_BACKEND_IMPORTS] }],
    },
  },
]
```

La mitad del backend sigue como estaba. `newtReactUi({ files, components, imports })` es
el lint de la librería para una app que la usa:

- **Las páginas componen componentes.** En `files`, fuera de `components`: ni atributos
  `className`, `class` o `style`, ni `<style>`, ni `cn` o `class-variance-authority`, ni
  más elementos HTML que `form` y `fieldset`. Una página está hecha de componentes de
  newt-react-ui, o de los propios de la app.
- **Nadie se salta la librería.** Nada de Radix, ni de las piezas internas de
  newt-react-ui: sus componentes son la puerta de entrada.
- **`components` puede dar estilo.** Los componentes propios de cooper (`cooper/libs/ui`,
  y la carpeta `components/` de una app si la tiene) envuelven los de newt-react-ui, con
  las clases de Tailwind.
- **`imports` añade la regla de cooper**: las apps nunca importan `backend/`.

Y un bloque propio de cooper: **`@cooper/api`** solo puede importar de `backend/` una
ruta de la forma `contexts/<context>/modules/<module>/<file>.schema.ts`, el contrato. Un
cliente que importara `card.module.ts` traería casos de uso, repositorios y `newt/core`
al navegador.

Esto es lo que dice el lint cuando una página se da estilo a sí misma, cuando escribe
HTML, y cuando un cliente se salta el esquema:

```text
cooper/frontend/boards/pages/home/bad.tsx
  1:27  error  A page is made of components: use one of newt-react-ui, or make one in the app's own components folder      no-restricted-syntax
  1:31  error  An app does not style: compose components of newt-react-ui, or make one in the app's own components folder  no-restricted-syntax

cooper/libs/api/card/bad.ts
  1:1  error  '../../../backend/contexts/boards/modules/card/card.module' import is restricted from being used by a pattern. @cooper/api may only import a backend module's *.schema.ts (its contract)  no-restricted-imports

✖ 3 problems (3 errors, 0 warnings)
```

El lint comprueba la ruta. Lo que mantiene el esquema mismo a salvo para un navegador es
que de newt solo toma `newt/contract`, y la mitad del backend también lo comprueba: la
regla `newt/schema-imports` de newt, parte del preset desde el principio, rechaza cualquier
otra entrada de newt en un `<m>.schema.ts`, aunque sea para un tipo. Solo lee los
imports del propio esquema, no los de los archivos que importa: que un objeto de valor
importe `newt/contract`, nunca `newt/core`, sigue siendo cosa tuya.

## Compruébalo

La comprobación, con el proyecto nuevo y el test de los clientes:

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```text
 116 pass
 0 fail
 444 expect() calls
Ran 116 tests across 14 files.
```

Construye las dos apps:

```sh
bun run cooper:build
```

```text
auth: 5 files in dist/cooper/auth
boards: 5 files in dist/cooper/boards
```

Luego arranca cooper en desarrollo:

```sh
bun run cooper
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/

  auth    http://localhost:3001
  boards  http://localhost:3002
```

Las dos apps responden en los puertos de sus contextos, junto a sus APIs:

```sh
curl -s localhost:3001 | grep -o '<title>.*</title>'
curl -s localhost:3002 | grep -o '<title>.*</title>'
curl -s localhost:3002/api/health
curl -s -i localhost:3002/api/session/sign-in | grep -i '^HTTP\|^location'
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"status":"ok"}
HTTP/1.1 302 Found
Location: http://localhost:3001/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
```

Abre `http://localhost:3002` en un navegador e inicia sesión: boards te manda a la página
de inicio de sesión de auth, en 3001, donde puedes registrarte; auth responde enseguida a
la petición de su propio producto (cooper no pide el consentimiento de nadie para iniciar
sesión en cooper), y vuelves a estar en boards. Edita una página y se recarga.

Detenlo con Ctrl+C. Las apps construidas se sirven igual, sin el ajuste:

```sh
bun cooper/backend/index.ts
```

```sh
curl -s localhost:3001/ | grep -o '<title>.*</title>'
curl -s localhost:3002/boards | grep -o '<title>.*</title>'
curl -s localhost:3002/api/nothing
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"error":"Cooper has nothing at GET /api/nothing","code":"route_not_found"}
```

`/boards` no es un archivo del build, así que recibe `index.html`; `/api/nothing` está bajo
`/api`, así que recibe un 404 que el cliente puede leer.

## Qué recordar

- `newt/contract` es la parte de newt que un navegador puede cargar: objetos de valor, las
  bases de los errores de dominio, `defineFilter`, `Page`, `PageRequest`, `ErrorBody`.
  `newt/core` guarda un scope en `node:async_hooks` y se queda en el servidor.
- El `*.schema.ts` de un módulo es su contrato, y el único archivo del backend que un
  cliente puede importar. Importa zod, `newt/contract`, objetos de valor y otros esquemas;
  cualquier otra cosa, solo como tipo. El lint mantiene a los clientes dentro de eso.
- Cada contexto sirve su app en su propio puerto, para toda dirección que sus rutas no
  toman, nunca bajo `/api`: desde su código fuente en desarrollo (`bun run cooper`),
  construida por Bun en producción (`bun run cooper:build`, `frontendFolder`). Sin proxy,
  sin nada delante.

Siguiente: [Un servidor MCP](./24-mcp-server).
