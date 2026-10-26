# Los frontends y newt/contract

El backend de cooper hace todo lo que una persona necesita: Ana se registra en auth, crea
Acme, inicia sesión en boards y guarda sus tarjetas. Pero lo hace todo con `curl`. Desde el
[capítulo 22](./22-web-session), boards manda su navegador al `/oauth/authorize` de auth, y
auth lo manda a páginas que todavía no tiene: un formulario de inicio de sesión y la página
donde ella le dice que sí a boards.

Este capítulo da a cooper sus dos apps web: la de **auth** (iniciar sesión, registrarse,
aprobar una aplicación) y la de **boards** (el SaaS: workspaces, tableros, tarjetas,
búsqueda, ajustes). Son apps de React construidas con Vite. El tutorial va del backend, así
que las copias del repositorio en vez de escribirlas. Lo que enseña este capítulo es dónde
tocan el backend y newt:

- **`newt/contract`**, la parte de newt que un navegador puede cargar, y por qué está
  aparte de `newt/core`;
- la regla que impide que el frontend importe el código del backend, mientras comparte su
  **contrato**, los `*.schema.ts` de los módulos;
- los clientes de la API, con `CardApi` en detalle: la `Idempotency-Key` del
  [capítulo 9](./09-idempotent-posts) y la búsqueda del [capítulo 16](./16-search-port);
- cómo llegan las apps a sus contextos: por el proxy de Vite en desarrollo, y servidas por
  los propios contextos una vez construidas (`frontendFolder`);
- los scripts `cooper` y `cooper:build`, un proyecto de TypeScript para el navegador y la
  mitad del lint que toca al frontend.

## Qué copias

Tres carpetas vienen del tag:

```sh
git checkout tutorial/23 -- cooper/frontend cooper/libs cooper/scripts/dev.ts
```

```
cooper/
  frontend/
    vite-app.ts            lo que comparten las configs de Vite de las dos apps
    auth/                  la app de auth: index.html, main.tsx, app.routes.tsx, pages/, services/, vite.config.ts
    boards/                la app de boards: la misma forma, con modules/ para sus zonas
  libs/
    api/                   @cooper/api: los clientes de la API, el único camino al backend
    core/                  @cooper/core: stores, formularios, un inyector, el tema
    ui/                    @cooper/ui: los componentes, el único sitio que da estilo
  scripts/
    dev.ts                 bun run cooper: el backend y los dos servidores de Vite
```

Luego sus dependencias, en las versiones que cooper fija:

```sh
bun add --exact @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0 @preact/signals-core@1.14.4 class-variance-authority@0.7.1 cn@0.4.0 lucide-react@1.48.0 radix-ui@1.7.0 react@19.3.0 react-dom@19.3.0 react-router@8.4.0 sonner@2.0.8 tw-animate-css@1.4.0
bun add --exact --dev @tailwindcss/vite@4.3.3 @types/react@19.3.0 @types/react-dom@19.3.0 @vitejs/plugin-react@6.1.2 tailwindcss@4.3.3 typescript-eslint@8.71.1 vite@8.3.4
```

El resto del capítulo se escribe a mano: dos archivos del backend cambian un poco, y los
scripts del `package.json` de la raíz, los `tsconfig*.json` y `eslint.config.js` crecen.
Los archivos que trajo el checkout y que tocan el backend o newt se muestran enteros más
abajo, para que sepas qué hacen.

## Las apps en pocas líneas

Las dos apps tienen la misma forma, y las mismas tres librerías debajo:

- **`@cooper/ui`** (`cooper/libs/ui`) son los componentes: botones, campos, diálogos,
  tablas, el tablero, el shell. Están construidos sobre shadcn y Radix, con estilos de
  Tailwind. Es el único sitio que da estilo; las apps componen sus componentes.
- **`@cooper/core`** (`cooper/libs/core`) es de lo que están hechos los servicios de las
  apps: un `Store` (el estado de un servicio en una señal, de `@preact/signals-core`), un
  `ListStore` (una lista leída página a página con un cursor, desde cualquier función que
  devuelva una `Page`), un `FormStore` (los valores de un formulario, sus errores y su
  envío, validado con un esquema de zod) y un inyector pequeño (`inject`, `Provide`,
  `useService`) que da a cada pantalla sus servicios.
- **`@cooper/api`** (`cooper/libs/api`) es un cliente por módulo del backend, más abajo.

Cada app es un `index.html`, un `main.tsx` que monta React y un `app.routes.tsx` con React
Router. Las rutas de auth son `sign-in`, `sign-up`, `authorize/:id` y `error`: las páginas
a las que su servidor OAuth manda el navegador. Las de boards están tras un guarda de
sesión (sin sesión: muestra un botón de iniciar sesión donde iría la página, que empieza
la ida y vuelta del capítulo 22 en `/api/session/sign-in`), y después las zonas del
workspace (`w/:workspaceId/boards`, `search`, `settings`), cada una cargada la primera vez
que alguien entra. Una pantalla es un componente que lee las señales de un servicio; el
servicio guarda el estado y llama a la API. Una pantalla puede decir de antemano lo que
el backend rechazaría: en un tablero, el menú de una columna desactiva *Remove* mientras
la columna tiene tarjetas, y en la última columna del tablero ("a board keeps one
column", [capítulo 8](./08-two-people-one-card)); el backend sigue respondiendo un 409
`card.column_not_empty` o `column.last` a quien lo pida igualmente.

Nada de eso toca newt. Lo que sí lo toca está en `@cooper/api`.

## newt/contract: lo que un navegador puede cargar

Desde el [capítulo 2](./02-first-module), tus esquemas y objetos de valor importan
`ValueObject` y `ValidationError` de `newt/contract`, no de `newt/core`. Este es el
motivo.

`newt/core` es lo que corre un backend. Entre sus piezas está el scope en que se ejecuta un
caso de uso: quién actúa, en qué workspace, con qué reloj, dentro de qué transacción. newt
lo guarda en un `AsyncLocalStorage`, de `node:async_hooks`, y `newt/core` lo crea al
cargarse el módulo. Un navegador no tiene `node:async_hooks`. Vite solo puede poner en su
lugar un sustituto vacío, y avisa cuando lo hace:

```text
[plugin rolldown:vite-resolve] Module "node:async_hooks" has been externalized for browser compatibility, imported by ".../packages/newt/core/scope/define-scope.ts".
```

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
al navegador.

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

## Hablar con la API: Requester

Todo cliente extiende `Requester`. Conoce la URL base, `/api`, y hace el resto de lo que
toda petición comparte: JSON de ida y vuelta, la cookie (`credentials: 'include'`) y una
respuesta fallida convertida en un `ApiError`:

```ts
// cooper/libs/api/core/requester.ts
import type { ErrorBody } from 'newt/contract'
import { ApiError } from './api-error'
import type { QueryParams } from './query-params'

const BASE_URL = '/api'

/**
 * What every API client shares: the base URL, query params, JSON in and out, and
 * turning a failed answer into an `ApiError`. A client only says its `path` and
 * which requests it makes.
 */
export abstract class Requester {

  /** Called when the backend says the session is gone (401), wherever the request came from. */
  static onUnauthorized: (() => void) | null = null

  /** The client's part of the URL, after `/api`: `/proposals`. */
  protected abstract readonly path: string

  protected get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.call<T>('GET', path, undefined, params)
  }

  /** With `headers` of its own, such as an `Idempotency-Key`. */
  protected post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.call<T>('POST', path, body, undefined, headers)
  }

  protected put<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PUT', path, body)
  }

  protected patch<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body)
  }

  protected delete<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path)
  }

  private async call<T>(method: string, path: string, body?: unknown, params?: QueryParams, headers?: Record<string, string>): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(path, params), {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
      })
    } catch (error) {
      throw new ApiError(0, error instanceof Error ? error.message : 'Request failed')
    }

    if (!response.ok) {
      if (response.status === 401) Requester.onUnauthorized?.()
      const failure = (await response.json().catch(() => null)) as Partial<ErrorBody> | null
      throw new ApiError(response.status, failure?.error ?? response.statusText ?? 'Request failed', failure?.code)
    }

    return (response.status === 204 ? undefined : await response.json()) as T
  }

  private url(path: string, params?: QueryParams): string {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) query.set(key, String(value))
    }
    const search = query.size ? `?${query}` : ''
    return `${BASE_URL}${this.path}${path}${search}`
  }
}
```

El fallo se lee como un `ErrorBody`, el tipo de `newt/contract`. Lance lo que lance el
backend, el router de newt responde con ese cuerpo ([capítulo 3](./03-pages-and-errors)),
así que un cliente lee todo fallo igual: `error` es el mensaje que mostrar, `code` es lo
que le sirve para actuar. `ApiError` guarda los dos, con el estado (0 si no hubo respuesta
alguna):

```ts
// cooper/libs/api/core/api-error.ts
/** A failed request: the backend's status, message and error `code`. Status 0 is no answer at all. */
export class ApiError extends Error {

  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
```

Los formularios actúan sobre `code`. Un `FormStore` recibe qué códigos pertenecen a qué
campo (`{ 'user.email_taken': 'email' }` en el formulario de registro) y sus propias
palabras para los que no pertenecen a ninguno (`{ 'card.too_many': '…' }` en los
formularios de tarjeta). El mensaje cambia con `setMessages`; el código nunca, así que es
en lo que se apoya el frontend.

Un 401 en cualquier sitio llama a `Requester.onUnauthorized`. El `main.tsx` de boards lo
fija para mostrar el camino para volver a iniciar sesión: cualquier petición que encuentre
la sesión perdida, la pantalla lo dice.

## CardApi

Este es el cliente del módulo `card` de boards, un método por ruta:

```ts
// cooper/libs/api/card/card.api.ts
import type {
  CardAssignDTO,
  CardCreateDTO,
  CardDTO,
  CardEditDTO,
  CardMoveDTO,
  CardSearchDTO,
} from '../../../backend/contexts/boards/modules/card/card.schema'
import type { Page } from 'newt/contract'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `card` module: the cards of a workspace's boards. */
export class CardApi extends Requester {
  protected readonly path = '/workspaces'

  /** A board's cards, column by column and from the top. */
  listInBoard(workspaceId: string, boardId: string) {
    return this.get<CardDTO[]>(`/${workspaceId}/boards/${boardId}/cards`)
  }

  getCard(workspaceId: string, cardId: string) {
    return this.get<CardDTO>(`/${workspaceId}/cards/${cardId}`)
  }

  /** A page of the workspace's cards with the text, that pass the filter. */
  search(workspaceId: string, input: CardSearchDTO, page?: PageRequest) {
    const query = new URLSearchParams()
    if (page?.size !== undefined) query.set('size', String(page.size))
    if (page?.cursor) query.set('cursor', page.cursor)
    return this.post<Page<CardDTO>>(`/${workspaceId}/cards/search${query.size ? `?${query}` : ''}`, input)
  }

  /**
   * A new card at the bottom of a column, with the board's next number. Each submit
   * has an `Idempotency-Key` of its own: the same request sent again with it (its
   * answer lost on the way) gets the card it made the first time, not a second one.
   */
  create(workspaceId: string, boardId: string, input: CardCreateDTO, idempotencyKey: string = crypto.randomUUID()) {
    return this.post<CardDTO>(`/${workspaceId}/boards/${boardId}/cards`, input, { 'idempotency-key': idempotencyKey })
  }

  edit(workspaceId: string, cardId: string, input: CardEditDTO) {
    return this.patch<CardDTO>(`/${workspaceId}/cards/${cardId}`, input)
  }

  /** To a column of its board, at a position (the bottom when none is given). */
  move(workspaceId: string, cardId: string, input: CardMoveDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/move`, input)
  }

  /** To a member of the workspace: a 400 `card.assignee_not_member` for anyone else. */
  assign(workspaceId: string, cardId: string, input: CardAssignDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/assign`, input)
  }

  unassign(workspaceId: string, cardId: string) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/unassign`)
  }

  remove(workspaceId: string, cardId: string) {
    return this.delete<void>(`/${workspaceId}/cards/${cardId}`)
  }
}
```

Dos métodos merecen una mirada.

**`create` envía una `Idempotency-Key`.** El [capítulo 9](./09-idempotent-posts) hizo que
`POST /boards/:boardId/cards` guardara la respuesta a cada clave, así que la misma
petición enviada de nuevo recibe la tarjeta que creó la primera. La clave la hace el
cliente, y aquí es donde cooper la hace: `crypto.randomUUID()`, una nueva cada vez que se
llama al método sin pasarla. El envío del formulario llama a `create` una vez por clic, así
que cada envío tiene su propia clave: dos clics son dos tarjetas, como debe ser. Quien
reenvía una petición porque perdió su respuesta (un reintento tras un timeout) pasa la
clave que usó la primera vez, como tercer argumento, y recibe la misma tarjeta. `post`
admite `headers` propios para esto.

`crypto.randomUUID()` está en todos los navegadores y en Bun, así que el mismo cliente
corre en la app y en un test.

**`search` envía un filtro y pide una página.** Su cuerpo es un `CardSearchDTO`: las
palabras, y un `filter` que `CardFilter` (el `defineFilter` del capítulo 15) comprueba en
el servidor: `board`, `column`, `assignee` y `number`, con sus operadores, como mucho dos
niveles y diez condiciones. El cliente lo construye a partir de lo que se elige en la
pantalla de búsqueda:

```ts
{ text: 'login', filter: { and: [{ field: 'board', op: 'eq', value: boardId }, { field: 'assignee', op: 'eq', value: userId }] } }
```

La página va en la query, `size` y `cursor`, y la respuesta es una `Page<CardDTO>`:
`items`, `hasMore`, `total`, y `nextCursor` cuando el servidor sabe dónde empieza la
página siguiente. La pantalla de búsqueda le da `search` a un `ListStore`, que pide la
primera página y luego más, desde donde la última dijo que empieza la siguiente: su
`nextCursor`, o si no el id de su último elemento. Una página de búsqueda puede llegar
vacía y aun así tener más detrás: el índice encontró tarjetas que ya no están, así que a
la página no le queda ninguna, pero su cursor sigue siendo la última encontrada.
`ListStore` sigue ese cursor, pasando las páginas vacías, hasta que una página trae
tarjetas o dice que no hay más; con el id de la última tarjeta mostrada volvería a pedir
la misma página. Los tipos de la página vienen de `newt/contract` (el `PageRequest` de
`@cooper/api` es el de newt, con `size` opcional); el `pageRequestFrom` del servidor lee
los mismos dos parámetros.

Su test reemplaza `fetch` y mira las cabeceras que envió cada llamada:

```ts
// cooper/libs/api/card/card.api.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { CardApi } from './card.api'

const originalFetch = globalThis.fetch
const sent: Headers[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  sent.length = 0
})

describe('CardApi', () => {
  test('sends each new card with an Idempotency-Key of its own, or the one it is given again', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return Response.json({ id: 'c-1' }, { status: 201 })
    }) as typeof fetch
    const cards = new CardApi()
    const input = { columnId: 'todo', title: 'Plan' }

    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input, 'submit-1')

    const keys = sent.map(headers => headers.get('idempotency-key'))
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).toBe('submit-1')
    expect(sent[0]!.get('content-type')).toBe('application/json')
  })
})
```

Es un test de `bun test cooper` como cualquier otro: los tests de las librerías (los
stores, el formulario, el inyector, el requester, este) vinieron con el checkout.

## Desarrollo: un servidor de Vite por app, y su proxy

En desarrollo cada app tiene un servidor de Vite, que la sirve desde el código fuente y la
recarga cuando editas. Las configs de las dos apps salen de una sola función:

```ts
// cooper/frontend/vite-app.ts
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type UserConfig } from 'vite'

type CooperApp = {
  /** The app's folder name under cooper/frontend, and under dist/cooper once built. */
  name: 'auth' | 'boards'
  /** The dev server's port. */
  port: number
  /** Paths the dev server hands to the backend: the app reaches it through its own origin. */
  proxy: string[]
}

/** Each context's port in dev, as the backend reads it (`COOPER_<NAME>_PORT`), with its defaults. */
const BACKEND_PORTS = { auth: 3001, boards: 3002 } as const

/** The app's context in dev, which the proxied paths go to. */
function backendOf(name: CooperApp['name']): string {
  return `http://localhost:${Number(process.env[`COOPER_${name.toUpperCase()}_PORT`] ?? BACKEND_PORTS[name])}`
}

const libs = (name: string) => fileURLToPath(new URL(`../libs/${name}`, import.meta.url))

/**
 * What the two apps share: React, Tailwind, the aliases of cooper's libraries,
 * a fixed dev port that proxies to the app's context, and the build in
 * `dist/cooper/<name>`, which that context serves in production.
 */
export function cooperApp({ name, port, proxy }: CooperApp): UserConfig {
  return defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@cooper/ui': libs('ui'),
        // The API client: the only way the frontend reaches the backend.
        '@cooper/api': libs('api'),
        '@cooper/core': libs('core'),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: Object.fromEntries(proxy.map(path => [path, backendOf(name)])),
    },
    build: {
      outDir: fileURLToPath(new URL(`../../dist/cooper/${name}`, import.meta.url)),
      emptyOutDir: true,
    },
  })
}
```

- **`resolve.alias`** asigna `@cooper/ui`, `@cooper/api` y `@cooper/core` a sus carpetas
  bajo `cooper/libs`. No son paquetes; los alias (y los `paths` de los tsconfig, más
  abajo) hacen que lo parezcan.
- **`server.port`** es fijo, con `strictPort`: si el puerto está ocupado, Vite falla en
  vez de pasar a otro.
- **`server.proxy`** manda las rutas que la app delega a su contexto, en su propio puerto
  (`COOPER_AUTH_PORT`, `COOPER_BOARDS_PORT`, con los valores por defecto del backend).
- **`build.outDir`** es `dist/cooper/<name>`, que el contexto sirve una vez construido.

La config de cada app es una línea:

```ts
// cooper/frontend/auth/vite.config.ts
import { cooperApp } from '../vite-app.ts'

// Signing in, signing up and granting access. Its context is the OAuth server: the
// API, the authorization endpoints and their metadata.
export default cooperApp({ name: 'auth', port: 5171, proxy: ['/api', '/oauth', '/.well-known'] })
```

```ts
// cooper/frontend/boards/vite.config.ts
import { cooperApp } from '../vite-app.ts'

// The SaaS. Its context serves the API.
export default cooperApp({ name: 'boards', port: 5172, proxy: ['/api'] })
```

El import nombra `../vite-app.ts` con su extensión, como lo necesitaría Node: Vite puede
cargar su config así, y el proyecto de TypeScript de las herramientas lo permite (más
abajo).

Los puertos no son arbitrarios: 5171 y 5172 son las **URLs públicas** de auth y boards en
`config.ts` (`COOPER_AUTH_PUBLIC_URL`, `COOPER_BOARDS_PUBLIC_URL`), las direcciones que la
gente abre. En desarrollo el navegador solo habla con el servidor de Vite. La app llama a
`/api/workspaces/acme/cards/...` en su propio origen, Vite lo pasa a `:3002` y la respuesta
vuelve por el mismo origen. Así, la cookie de sesión de boards se fija en
`localhost:5172`, el mismo origen en que está la página, y una redirección que boards
construye desde su URL pública (`/api/session/callback`) cae en el servidor de Vite, que
la vuelve a pasar. El proxy de auth tiene más rutas porque su contexto sirve más que su
API: los endpoints de OAuth (`/oauth/authorize`, `/oauth/token`) y sus metadatos bajo
`/.well-known`.

## Producción: cada contexto sirve su frontend

Ya construido, no hay Vite. Cada contexto sirve su propia app, en su propio puerto y, en
producción, su propio dominio: la URL pública y la dirección del contexto vuelven a ser la
misma. Añade a `config.ts` dónde encuentra cada contexto su build, al final de `auth`:

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
}
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
  archivo (`/assets/index-….js`, `/cooper.svg`); cualquier otra recibe `index.html`, así
  que `/w/acme/boards` abre la app y React Router muestra el tablero (o su propio "no
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

## Los scripts: cooper y cooper:build

Añade dos scripts al `package.json` de la raíz, alrededor de `cooper:seed`:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards"
```

`cooper:build` construye las dos apps en `dist/cooper/auth` y `dist/cooper/boards`, las
carpetas que `frontendFolder` nombra por defecto. `cooper` arranca cooper en desarrollo con
el script que trajo el checkout:

```ts
// cooper/scripts/dev.ts
// bun run cooper: cooper in development, and stops it all together. The backend (every
// context, each on its port) and the Vite server of each frontend, which sends the
// API's addresses on to its context. With --watch the backend restarts on every change.
// Each service runs in its own process group, so stopping it also stops what it spawns.
// The ports are fixed (each service fails instead of moving to another one), so the
// links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

/** A frontend's Vite server, on the port of its context's public URL. */
const frontend = (name: 'auth' | 'boards') => {
  const url = config[name].publicUrl
  return { name: `${name} UI`, url, cmd: ['bun', 'x', 'vite', `cooper/frontend/${name}`, '--port', new URL(url).port, '--strictPort'] }
}

const SERVICES = [
  frontend('auth'),
  frontend('boards'),
  { name: 'backend', url: `http://localhost:${config.auth.port}/api/health`, cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'] },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = [
  ...SERVICES.filter(service => service.name !== 'backend').map(({ name, url }) => ({ name, port: Number(new URL(url).port) })),
  ...(['auth', 'boards'] as const).map(name => ({ name: `${name} API`, port: config[name].port })),
]

// Nothing starts unless every port is free: `bun --watch`, for one, stays alive after
// failing to listen, so a taken port would go unnoticed otherwise.
async function isTaken(port: number) {
  for (const hostname of ['127.0.0.1', '::1']) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: { data() {} } })
      socket.end()
      return true
    } catch {
      // Nothing listening on this address.
    }
  }
  return false
}

const taken = (await Promise.all(PORTS.map(async each => ((await isTaken(each.port)) ? each : null)))).filter(each => each !== null)
if (taken.length > 0) {
  for (const { name, port } of taken) console.error(`${name}: port ${port} is already in use`)
  console.error('Nothing was started.')
  process.exit(1)
}

const children = SERVICES.map(({ cmd }) => Bun.spawn(cmd, { detached: true, stdio: ['inherit', 'inherit', 'inherit'] }))

function signalGroups(signal: NodeJS.Signals) {
  for (const child of children) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      // The group is already gone.
    }
  }
}

let stopping = false

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  signalGroups('SIGINT')
  // Whatever ignores SIGINT gets SIGTERM after a grace period.
  const timeout = setTimeout(() => signalGroups('SIGTERM'), 3000)
  await Promise.all(children.map(child => child.exited))
  clearTimeout(timeout)
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown())

// If any service dies on its own, everything stops with it.
children.forEach((child, index) => {
  void child.exited.then(code => {
    if (stopping) return
    console.error(`${SERVICES[index]!.name} exited (code ${code}): stopping everything.`)
    void shutdown(1)
  })
})

async function waitUntilUp(url: string) {
  while (!stopping) {
    try {
      await fetch(url)
      return
    } catch {
      await Bun.sleep(200)
    }
  }
}

// Once everything answers, print where each frontend lives.
void Promise.all(SERVICES.map(({ url }) => waitUntilUp(url))).then(() => {
  if (stopping) return
  const names = ['auth', 'boards'] as const
  const width = Math.max(...names.map(name => name.length))
  console.log(['', ...names.map(name => `  ${name.padEnd(width)}  ${config[name].publicUrl}  (API on port ${config[name].port})`), ''].join('\n'))
})

await Promise.all(children.map(child => child.exited))
```

Arranca tres procesos: el backend (`bun --watch cooper/backend/index.ts`, que lo reinicia
en cada cambio) y un servidor de Vite por app, cada uno en el puerto de la URL pública de
su contexto. Antes de arrancar nada comprueba que los cuatro puertos están libres: `bun
--watch` sigue vivo tras fallar al escuchar, así que un puerto ocupado pasaría
desapercibido. Cada proceso corre en un grupo propio, así que Ctrl+C también detiene lo que
cada uno lanzó; lo que ignore el `SIGINT` recibe un `SIGTERM` tres segundos después. Si uno
muere por su cuenta, todo se detiene con él. Cuando todos responden, imprime dónde vive
cada app.

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
    "types": ["vite/client", "bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"],
      "@cooper/core/*": ["./cooper/libs/core/*"]
    }
  },
  "include": [
    "cooper/frontend/**/*.ts",
    "cooper/frontend/**/*.tsx",
    "cooper/libs/**/*.ts",
    "cooper/libs/**/*.tsx",
    "cooper/backend/contexts/*/modules/*/*.schema.ts"
  ],
  "exclude": ["**/node_modules", "cooper/frontend/*/vite.config.ts"]
}
```

Fíjate en el último `include`: los esquemas de los módulos se comprueban también en este
proyecto, con los tipos del navegador, además de en el del backend. `bun` sigue en `types`
porque los tests de las librerías corren con `bun test`.

El `tsconfig.json` de la raíz lo referencia, y repite los `paths`, porque Bun resuelve los
imports (en `bun test`) con el archivo de la raíz:

```json
{
  // The whole repository, as four projects: the framework (newt), what runs on the
  // server (cooper's backend), what runs in the browser (cooper's frontends and their
  // libraries), and the tools around them (scripts, Vite's configs). `bun check` follows the references.
  // The paths are here too because Bun resolves imports with this file. newt is not among
  // them: it is a workspace package, reached through its `exports` as any application reaches it.
  "compilerOptions": {
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"],
      "@cooper/core/*": ["./cooper/libs/core/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Las configs de Vite corren en Bun, no en el navegador, así que se dejan fuera del proyecto
del frontend y van al de las herramientas. En `tsconfig.node.json`, cambia el comentario y
el `include`, y permite los imports de las configs con extensión `.ts`
(`allowImportingTsExtensions`, que necesita `noEmit`):

```json
{
  // The tools around the application: cooper's scripts and its frontends' Vite configs.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "moduleDetection": "force",
    "noEmit": true,
    // A Vite config imports its neighbour as Node would load it: with its extension.
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["cooper/scripts/**/*.ts", "cooper/frontend/*/vite.config.ts"],
  "exclude": ["**/node_modules"]
}
```

## Lint: la mitad del frontend

`newt-eslint` hace el lint del backend. El frontend recibe reglas propias, en el mismo
`eslint.config.js`. Reemplázalo:

```js
import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends the rules of a UI built from one library. The framework's own code is not
// an application, so it is left out.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})

// The frontends build their UI from @cooper/ui only. Styling lives in cooper/libs/ui and
// in each app's own components/ folder; everywhere else, class names and inline styles
// are forbidden, and so is reaching past @cooper/ui into shadcn or Radix.

const FRONTEND = ['cooper/frontend/**/*.{ts,tsx}', 'cooper/libs/**/*.{ts,tsx}']
// Where styling is allowed: the UI library, and each app's own UI pieces.
const STYLED = ['cooper/libs/ui/**', 'cooper/frontend/*/components/**']

const STYLING_MESSAGE = 'Apps do not style: use a component from @cooper/ui or from this app\'s own components/ folder.'

const UI_IMPORTS = [
  { group: ['radix-ui', '@radix-ui/*'], message: 'Use a component from @cooper/ui instead.' },
  { group: ['@cooper/ui/shadcn', '@cooper/ui/shadcn/*', '**/libs/ui/shadcn', '**/libs/ui/shadcn/**'], message: 'shadcn is private to @cooper/ui: use @cooper/ui/components/*.' },
]

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

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  {
    files: FRONTEND,
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ['cooper/frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, API_BACKEND_IMPORTS] }],
    },
  },
  {
    files: FRONTEND,
    ignores: STYLED,
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'JSXAttribute[name.name=/^(className|class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXAttribute > JSXNamespacedName[namespace.name=/^(class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXElement[openingElement.name.name="style"]', message: STYLING_MESSAGE },
      ],
    },
  },
]
```

La mitad del backend sigue como estaba. La mitad del frontend usa las reglas propias de
ESLint, con el parser de typescript-eslint para `.ts` y `.tsx`:

- **Las apps** (`cooper/frontend`) nunca importan `backend/`, ni Radix o shadcn
  directamente: lo que muestran viene de `@cooper/ui`, lo que piden viene de
  `@cooper/api`.
- **`@cooper/ui`** tampoco importa nunca `backend/`.
- **`@cooper/api`** solo puede importar de `backend/` una ruta de la forma
  `contexts/<context>/modules/<module>/<file>.schema.ts`: el contrato. Un cliente que
  importara `card.module.ts` traería casos de uso, repositorios y `newt/core` al
  navegador.
- **Nadie da estilo** fuera de `cooper/libs/ui` y de la carpeta `components/` de una app:
  ni atributos `className`, `class` o `style`, ni elemento `<style>`.

Esto es lo que dice el lint cuando un cliente se salta el esquema, y cuando una página se
da estilo a sí misma:

```text
cooper/frontend/boards/pages/home/bad.tsx
  1:29  error  Apps do not style: use a component from @cooper/ui or from this app's own components/ folder  no-restricted-syntax

cooper/libs/api/card/bad.ts
  1:1  error  '../../../backend/contexts/boards/modules/card/card.module' import is restricted from being used by a pattern. @cooper/api may only import a backend module's *.schema.ts (its contract)  no-restricted-imports

✖ 2 problems (2 errors, 0 warnings)
```

El lint comprueba la ruta. Lo que mantiene el esquema mismo a salvo para un navegador es
que de newt solo toma `newt/contract`, y la mitad del backend también lo comprueba: la
regla `newt/schema-imports` de newt, parte del preset desde el principio, rechaza cualquier
otra entrada de newt en un `<m>.schema.ts`, aunque sea para un tipo. Solo lee los
imports del propio esquema, no los de los archivos que importa: que un objeto de valor
importe `newt/contract`, nunca `newt/core`, sigue siendo cosa tuya.

## Compruébalo

La comprobación, con el proyecto nuevo y los tests de las librerías:

```sh
bun install && bun check && bun test cooper && bun run lint
```

```text
 142 pass
 0 fail
 492 expect() calls
Ran 142 tests across 19 files.
```

Construye las dos apps:

```sh
bun run cooper:build
ls dist/cooper
```

```text
auth
boards
```

Y arranca todo:

```sh
bun run cooper
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/

  VITE v8.3.4  ready in 229 ms

  ➜  Local:   http://localhost:5171/

  VITE v8.3.4  ready in 224 ms

  ➜  Local:   http://localhost:5172/

  auth    http://localhost:5171  (API on port 3001)
  boards  http://localhost:5172  (API on port 3002)
```

Las dos apps responden, y la API de boards responde a través de su servidor de Vite:

```sh
curl -s localhost:5171 | grep -o '<title>.*</title>'
curl -s localhost:5172 | grep -o '<title>.*</title>'
curl -s localhost:5172/api/health
curl -s -i localhost:5172/api/session/sign-in | grep -i '^HTTP\|^location'
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"status":"ok"}
HTTP/1.1 302 Found
location: http://localhost:5171/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A5172%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
```

Iniciar sesión va a la app de auth, y vuelve al servidor de Vite de boards. Abre
`http://localhost:5172` en un navegador e inicia sesión: boards te manda a la página de
inicio de sesión de auth, donde puedes registrarte; auth responde enseguida a la petición
de su propio producto (cooper no pide el consentimiento de nadie para iniciar sesión en
cooper), y vuelves a estar en boards.

Las apps construidas las sirven los propios contextos, en sus puertos:

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
`/api`, así que recibe un 404 que el cliente puede leer. Ctrl+C lo detiene todo.

## Qué recordar

- `newt/contract` es la parte de newt que un navegador puede cargar: objetos de valor, las
  bases de los errores de dominio, `defineFilter`, `Page`, `PageRequest`, `ErrorBody`.
  `newt/core` guarda un scope en `node:async_hooks` y se queda en el servidor.
- El `*.schema.ts` de un módulo es su contrato, y el único archivo del backend que un
  cliente puede importar. Importa zod, `newt/contract`, objetos de valor y otros esquemas;
  cualquier otra cosa, solo como tipo. El lint mantiene a los clientes dentro de eso.
- Un cliente lee todo fallo como un `ErrorBody` y actúa sobre `code`, nunca sobre el
  mensaje.
- El cliente hace la `Idempotency-Key`: un `crypto.randomUUID()` nuevo por envío, el mismo
  cuando se reenvía el mismo envío.
- En desarrollo el navegador habla solo con Vite, en la URL pública del contexto, que hace
  de proxy de las rutas del contexto; ya construido, cada contexto sirve su propia app
  (`frontendFolder`) para toda dirección que sus rutas no toman, nunca bajo `/api`.

Siguiente: [Un servidor MCP](./24-mcp-server).
