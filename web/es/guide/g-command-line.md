# G. La línea de comandos

newt trae un comando, `newt`, que prepara una aplicación para los agentes de
programación y escribe el esqueleto de un módulo. Escribe ficheros y no importa
ninguna pieza de newt. Nunca sobrescribe un fichero: lo que ya existe lo nombra y lo
deja como estaba.

```sh
bunx newt init                                   # in an application's folder
bunx newt add module src/contexts/shop order     # a module's skeleton
bunx newt help
```

Cualquier otro comando imprime esa ayuda y sale con 1.

## `newt init`

Ejecútalo en la carpeta de una aplicación. Escribe tres ficheros.

| Fichero | Qué contiene |
|---|---|
| `AGENTS.md` | Las instrucciones propias de la aplicación para los agentes (Codex, Cursor, Copilot, Claude Code…): secciones que rellenar sobre el proyecto, sus contextos, sus convenciones y sus comandos. Empieza mandando a los agentes a `node_modules/newt/AGENTS.md`. |
| `CLAUDE.md` | Dos líneas, `@AGENTS.md` y `@node_modules/newt/AGENTS.md` (o la ruta donde encontró el de newt): Claude Code importa los dos ficheros a su memoria. |
| `eslint.config.js` | El lint de newt (`newt()` de `newt-eslint`), solo si no hay configuración de ESLint en esta carpeta ni en ninguna de arriba. |

`node_modules/newt/AGENTS.md` es el de newt: las reglas del framework, la anatomía de
un módulo, un fragmento de cada pieza, qué hacer ante cada error que lanza newt, las
reglas del lint, los comandos y una definición de "hecho". Viaja con el paquete, así
que siempre describe la versión instalada: actualizar newt lo actualiza. El
`AGENTS.md` de la aplicación dice solo lo que es propio de ella.

Los dos ficheros se buscan en la carpeta y en las de arriba, igual que instala Bun y
que ESLint busca su configuración. Una aplicación dentro de un monorepo apunta al
`node_modules` de la raíz y conserva el lint de la raíz: `newt init` dice qué
configuración encontró y que el preset de newt va en ella.

Termina imprimiendo lo que queda por hacer: instalar newt y su lint, rellenar
`AGENTS.md` y añadir el primer módulo. En una carpeta nueva:

```text
wrote    AGENTS.md
wrote    CLAUDE.md
wrote    eslint.config.js

Next:
  bun add newt zod
  bun add -d newt-eslint eslint typescript@npm:@typescript/typescript6@6.0.2
  fill in AGENTS.md: the project, its contexts, its conventions
  newt add module <context-folder> <module>   e.g. newt add module src/contexts/shop order
```

Si lo ejecutas otra vez, no escribe nada: `skipped  AGENTS.md (it is there already:
left as it was)`, y lo mismo con los demás. cooper está en un monorepo cuya raíz tiene
el lint, así que en `cooper/` escribe los dos primeros y deja el tercero a la raíz
([capítulo 1](./01-project-and-context)):

```text
skipped  eslint.config.js (../eslint.config.js is there: add newt-eslint's preset to it, `newt()`)
```

y el `CLAUDE.md` de cooper importa `@../node_modules/newt/AGENTS.md`.

## `newt add module <carpeta-del-contexto> <nombre>`

Escribe el esqueleto de un módulo en `<carpeta-del-contexto>/modules/<nombre>/`, con
la anatomía y los nombres que pide el lint de newt. `<nombre>` va en kebab-case:
`price-change` da `PriceChange_Module`, el prefijo de los casos de uso `priceChange`, la
tabla `price_change` y las rutas `/price-changes`.

| Fichero | Qué contiene |
|---|---|
| `<nombre>.schema.ts` | El contrato del módulo con zod: la entidad y lo que envía un cliente. |
| `<nombre>.ts` | La entidad. |
| `<nombre>.repository.ts` | Su repositorio, con `scope: 'none'` y una nota: decídelo, el scope de un tenant o ninguno y por qué. |
| `<nombre>.module.ts` | El módulo, con dos casos de uso, `create` y `get`. |
| `<nombre>.deps.ts` | Los módulos que usa, vacío. |
| `<nombre>.routes.ts` | Sus rutas, que pasan el cuerpo al caso de uso tal como llegó. |
| `events/<nombre>-created.ts` | El evento que cuenta `create`. |
| `errors/<nombre>-not-found.ts` | El error que lanza `get`. |
| `<nombre>.test.ts` | Sus tests, sobre un store de ficheros. |

El esqueleto compila, pasa el lint y sus propios tests. Lo que no sabe te toca a ti: el
scope de su repositorio, una migración para su tabla y su sitio en el
`initialize-modules.ts` del contexto. El comando imprime esos pasos:

```text
wrote    src/contexts/shop/modules/price-change/price-change.schema.ts
wrote    src/contexts/shop/modules/price-change/price-change.ts
wrote    src/contexts/shop/modules/price-change/price-change.repository.ts
wrote    src/contexts/shop/modules/price-change/price-change.module.ts
wrote    src/contexts/shop/modules/price-change/price-change.deps.ts
wrote    src/contexts/shop/modules/price-change/price-change.routes.ts
wrote    src/contexts/shop/modules/price-change/events/price-change-created.ts
wrote    src/contexts/shop/modules/price-change/errors/price-change-not-found.ts
wrote    src/contexts/shop/modules/price-change/price-change.test.ts

Next:
  decide the scope in src/contexts/shop/modules/price-change/price-change.repository.ts: a tenant's { field, current }, or 'none' with the reason
  add a migration for the table 'price_change' in each dialect's migrations folder (FileStore needs none)
  initialize PriceChange_Module in the context, after the modules it uses, with its deps
  bun check && bun test && bunx eslint
```

Un nombre que no está en kebab-case se rechaza, con código de salida 1: `'Price' is not
a module's folder name: lower-case words in kebab case, as price-change`. Un fichero
que ya existe se salta, como hace `newt init`.

En el tutorial, los módulos de cooper se escriben a mano, fichero a fichero, para
explicar cada uno; el [capítulo 6](./06-rules-over-rows) señala dónde el comando
habría escrito el esqueleto.

## newt-graph

`newt-graph` (en `packages/newt-graph`) dibuja una aplicación newt, leída de su código
con el checker de TypeScript, como la lee el editor: sin anotaciones y sin IA. Sus
contextos contienen sus módulos, que contienen sus casos de uso, eventos y rutas; las
aristas son las llamadas entre casos de uso, los eventos que cuenta cada uno, las
suscripciones y los schedules que despiertan workers, y las rutas que llegan a ellos.

```sh
bun run cooper:graph                 # cooper, in this repository
bunx newt-graph                      # serves the page on http://localhost:4747 and opens it
bunx newt-graph --out graph.html     # one self-contained file: no server, no network
bunx newt-graph --json               # the model, as JSON
```

Cada recarga de la página servida vuelve a leer el código. `--root` dice la carpeta del
backend (por defecto, la que está encima del `contexts.folder` de newt-eslint), y
`--tests` añade los tests y los fakes, marcados como tales.

En la página:

- **Cuánto se dibuja**: `1` contextos, `2` módulos, `3` casos de uso, `4` también los
  eventos como nodos. Un doble clic (o `x`) abre o cierra un contexto o un módulo en su
  sitio.
- **Búsqueda** (`/`), aproximada; **filtros** por contexto, por tipo de arista, y solo
  lo que toca la selección (`s`); **marcas** (`m`), guardadas en el navegador.
- **Efectos** (`e`): lo que pone en marcha un caso de uso, animado: primero las
  llamadas de la petición, después cada salto de worker como una oleada posterior, en
  cualquier contexto. El panel lateral lo muestra como un árbol: una llamada, un evento
  contado cuando su guardado hace commit, un job (de qué outbox, su cola, su `when`).
- **Quién puede causarlo** (`u`): la misma cadena al revés, primero la causa más lejana.
- **Dependencias** (`d`): los módulos con sus llamadas, eventos y deps declaradas, y los
  `uses` de los contextos; una arista hacia un contexto no usado sale en rojo.
- **Detalles**: haz clic en cualquier cosa para ver su `file:line`, con un enlace
  `vscode://` que lo abre.

Lo que leer el código no puede saber: un valor elegido en tiempo de ejecución cuenta
como cada módulo que puede ser; un evento contado en una rama de un `if` se dibuja como
contado, y un `when` se muestra, no se evalúa; las llamadas a través de un `Map`, de
`any`, de `bind` o de una clase detrás de una interfaz (la búsqueda, el mailer) no se
siguen; las entradas que no son el router de newt (las herramientas de un servidor MCP)
solo aparecen donde pasan por una ruta; un nombre hecho en tiempo de ejecución no se
conoce. Los propios tests de newt-graph abren cooper y comprueban que cada cola y cada
schedule que registra está en el grafo.
