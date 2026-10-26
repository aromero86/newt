import { join } from 'node:path'
import type { Graph } from '../model'

let bundled: Promise<string> | undefined

/** The page's script, with Cytoscape in it, bundled once per process. */
function clientScript(): Promise<string> {
  bundled ??= (async () => {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'client', 'main.ts')], target: 'browser', minify: true, format: 'iife' })
    if (!result.success) throw new AggregateError(result.logs, 'The page did not build')
    return await result.outputs[0]!.text()
  })()
  return bundled
}

/** Text safe inside a `<script>`: nothing in it closes the tag. */
const safeInScript = (text: string) => text.replace(/<\/(script)/gi, '<\\/$1')

/** The page, whole: its style, its script and the graph in one HTML file, which needs no network. */
export async function buildPage(graph: Graph): Promise<string> {
  const [script, style] = await Promise.all([clientScript(), Bun.file(join(import.meta.dir, 'client', 'style.css')).text()])
  const title = `${graph.app.name} · newt-graph`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${style}</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="graph">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>
<script>${safeInScript(script)}</script>
</body>
</html>
`
}
