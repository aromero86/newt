# Sus páginas

El monitor recibe sus páginas: una app de React, dentro del paquete, que sirve el propio
monitor. Un proceso y una dirección, como [los contextos de cooper](../guide/23-frontends)
sirven las suyas. Esta guía no enseña la app: está hecha con `newt-react-ui` y
`newt-react`, cuyos `AGENTS.md` enseñan cómo. Este capítulo es cómo se construye y cómo
la sirve el monitor.

Al final tendrás estos archivos:

```
package.json                          cambia: `bun run monitor` sirve el código fuente, `bun run monitor:build`
tsconfig.json                         cambia: un proyecto más
tsconfig.newt-monitor.json            cambia: el frontend no está en él
tsconfig.newt-monitor-frontend.json   el proyecto del frontend, para el navegador
eslint.config.js                      cambia: el lint del frontend
monitor.Dockerfile                    cambia: construye el frontend
packages/newt-monitor/
  package.json                        cambia: con qué se construye el frontend
  frontend/                           la app: index.html, app.css, main.tsx, sus páginas
  scripts/build.ts                    el frontend, construido
  scripts/dev.ts                      el monitor, con su frontend desde el código fuente
  src/config.ts                       cambia: dónde está la build, o el código fuente
  src/main.ts                         cambia: el código fuente, en desarrollo
  src/contexts/monitor/monitor.context.ts  cambia: sirve la build
```

## Construido: el monitor sirve su carpeta

Dos ajustes dicen de dónde sale el frontend:

```ts
// packages/newt-monitor/src/config.ts
  /** Its built frontend (`bun run monitor:build`). */
  NEWT_MONITOR_FRONTEND: z.string().trim().min(1).default(join(import.meta.dir, '../dist/frontend')),
  /** `1` (`bun run monitor` sets it): the frontend from its sources, which Bun builds as it serves them. */
  NEWT_MONITOR_FRONTEND_SOURCES: z.enum(['0', '1']).default('0'),
```

La carpeta es por defecto el `dist/frontend` del propio paquete, se arranque el monitor
desde donde se arranque. El contexto se la pasa a `serve` como `frontend`:

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true, frontend: this.config.frontend }
  }
```

Toda dirección que la API no toma recibe un archivo de la carpeta, o su `index.html`,
así que `/apps/…` abre la app y su router muestra la página. Bajo `/api` nunca es la app:
una dirección que ninguna ruta toma es un 404 que el cliente puede leer. Mientras la
carpeta no tenga `index.html`, las páginas responden un 503 que dice que no está
construido, y la API funciona igual: por eso los tests no necesitan build.

```ts
// packages/newt-monitor/src/monitor.test.ts
  test('hands its frontend every other address, and says so while it is not built', async () => {
    monitor = await openTestMonitor()

    const page = await monitor.fetch('/apps/cooper')
    expect(page.status).toBe(503)
    expect(await page.text()).toContain('not built')
  })
```

## Construirlo

`bun run monitor:build` construye la app con `Bun.build`, desde su `index.html`, con
Tailwind:

```ts
// packages/newt-monitor/scripts/build.ts
const built = await Bun.build({
  entrypoints: [join(PACKAGE, 'frontend/index.html')],
  outdir: out,
  plugins: [tailwind],
  minify: true,
  // From the root: the app's router serves index.html at every address, however deep.
  publicPath: '/',
  sourcemap: 'linked',
  target: 'browser',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
})
```

Con lo que se construye son las `devDependencies` del paquete: React, React Router,
`newt-react`, `newt-react-ui` y `bun-plugin-tailwind`. La imagen las instala, construye
y arranca:

```
# monitor.Dockerfile
RUN bun install --frozen-lockfile

COPY bunfig.toml ./
COPY packages/newt packages/newt
COPY packages/newt-react packages/newt-react
COPY packages/newt-react-ui packages/newt-react-ui
COPY packages/newt-monitor packages/newt-monitor
RUN bun run monitor:build
```

## En desarrollo: desde el código fuente

`bun run monitor` arranca el monitor con `NEWT_MONITOR_FRONTEND_SOURCES=1` y `--watch`.
Entonces `main` pasa a `serve` el `index.html` de la app importado en vez de la carpeta:
Bun lo construye mientras lo sirve y recarga la página cuando cambian sus archivos.

```ts
// packages/newt-monitor/src/main.ts
  // In development its frontend comes from its sources, as Bun builds them; imported
  // only then, so production never builds it as it starts.
  const sources = config.frontendSources ? { frontend: (await import('../frontend/index.html')).default, development: true } : {}
  const app = runContexts([{ context: monitor, serve: { ...monitor.serving(), ...sources } }])
```

El `bunfig.toml` de la raíz da Tailwind a esa build, como se lo da a la de cooper.

## Su propio proyecto y su lint

El proyecto del backend no tiene DOM. El frontend tiene uno propio,
`tsconfig.newt-monitor-frontend.json`, que además comprueba los `*.schema.ts` de los
módulos con los tipos del navegador: son el contrato que la app comparte con la API.

En `eslint.config.js` el backend conserva el lint de newt, ahora sobre `bin`, `scripts`
y `src`, y el frontend recibe el de `newt-react-ui`: las páginas componen componentes y
no dan estilo a nada. Del backend, la app importa solo los esquemas de sus módulos, y
solo desde sus clientes de la API, en `frontend/api`.

## Compruébalo

```sh
bun check
bun test packages/newt-monitor
bun run lint
bun run monitor:build
docker build -f monitor.Dockerfile -t newt-monitor .
```

```text
newt-monitor: 5 files in packages/newt-monitor/dist/frontend
```

## Lo que hay que recordar

- El monitor sirve sus propias páginas: un proceso, una dirección, sin proxy.
- Construidas en producción (`monitor:build`, `NEWT_MONITOR_FRONTEND`), desde el código
  fuente en desarrollo (`bun run monitor`).
- Bajo `/api`, nunca la app; antes de la build, un 503 que lo dice.
