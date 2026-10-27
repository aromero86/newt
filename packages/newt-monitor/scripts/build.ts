// bun run monitor:build: the monitor's frontend built by Bun, with Tailwind, into
// packages/newt-monitor/dist/frontend: the folder it serves in production. What its
// index.html names (its icon, its styles, its script) is built with it.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import tailwind from 'bun-plugin-tailwind'

const PACKAGE = join(import.meta.dir, '..')
const out = join(PACKAGE, 'dist/frontend')

await rm(out, { recursive: true, force: true })
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
if (!built.success) {
  for (const log of built.logs) console.error(log)
  process.exit(1)
}
console.log(`newt-monitor: ${built.outputs.length} files in packages/newt-monitor/dist/frontend`)
