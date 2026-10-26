import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { contextsFromEslint, loadConfig } from './config'
import { analyze } from './extract/analyze'
import type { Graph } from './model'
import { buildPage } from './page/build-page'

const HELP = `newt-graph: draws a newt application, read from its code.

Usage: newt-graph [options]

  --root <dir>       the backend's folder (default: the one above newt-eslint's contexts folder, else .)
  --tsconfig <file>  the tsconfig that compiles it (default: the nearest one; a solution is followed)
  --config <file>    a config file (default: newt-graph.config.{ts,js,json} here, if there is one)
  --json             print the graph as JSON and stop
  --out <file>       write the page, whole, to a file (no network needed to open it)
  --open             open the page in the browser (with --out); serving opens it unless --no-open
  --no-open          serve without opening the browser
  --port <n>         the port to serve on (default 4747; 0 for any free one)
  --tests            analyse tests and testing/ helpers too (the page hides them unless asked)
  --help             this

With neither --json nor --out it serves the page and reads the code again on each reload.`

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: 'string' },
      tsconfig: { type: 'string' },
      config: { type: 'string' },
      json: { type: 'boolean' },
      out: { type: 'string' },
      open: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      port: { type: 'string' },
      tests: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  })
  if (values.help) {
    console.log(HELP)
    return 0
  }
  const { config } = await loadConfig(cwd, values.config)
  const eslint = config.uses && config.root ? null : await contextsFromEslint(cwd)
  const root = values.root ? resolve(cwd, values.root) : config.root ?? (eslint ? dirname(eslint.folder) : cwd)
  const read = (): Graph => analyze({
    root,
    tsconfig: values.tsconfig ? resolve(cwd, values.tsconfig) : config.tsconfig,
    base: cwd,
    tests: values.tests ?? config.tests ?? false,
    uses: config.uses ?? eslint?.uses,
    name: config.name,
  })

  if (values.json) {
    const json = JSON.stringify(read(), null, 2)
    if (values.out) await Bun.write(resolve(cwd, values.out), json)
    else console.log(json)
    return 0
  }

  if (values.out) {
    const out = resolve(cwd, values.out)
    const graph = read()
    await Bun.write(out, await buildPage(graph))
    console.log(`${summary(graph)}\nWrote ${out}`)
    if (values.open) openInBrowser(out)
    return 0
  }

  let graph = read()
  console.log(summary(graph))
  const server = Bun.serve({
    port: values.port === undefined ? 4747 : Number(values.port),
    routes: {
      // Each load reads the code again: change it, reload, and the page follows.
      '/': async () => {
        graph = read()
        return new Response(await buildPage(graph), { headers: { 'content-type': 'text/html; charset=utf-8' } })
      },
      '/graph.json': () => Response.json(graph),
    },
  })
  console.log(`Serving ${server.url} (Ctrl+C to stop)`)
  if (!values['no-open']) openInBrowser(server.url.href)
  await new Promise(() => {})
  return 0
}

function summary(graph: Graph): string {
  const lines = [
    `${graph.app.name}: ${graph.contexts.length} contexts, ${graph.modules.length} modules, ${graph.useCases.length} use cases, ${graph.events.length} events, ${graph.subscriptions.length} subscriptions, ${graph.routes.length} routes`,
  ]
  for (const warning of graph.warnings) lines.push(`  warning: ${warning.file}:${warning.line} ${warning.message}`)
  return lines.join('\n')
}

function openInBrowser(target: string): void {
  const command = process.platform === 'darwin' ? ['open', target] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', target] : ['xdg-open', target]
  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    console.log(`Open ${target} in your browser`)
  }
}
