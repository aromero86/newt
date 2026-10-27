// bun run cooper:build: each frontend built by Bun, with Tailwind, into dist/cooper/<app>:
// the folder its context serves in production. What its index.html names (its icon, its
// styles, its script) is built with it.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import tailwind from 'bun-plugin-tailwind'

const ROOT = join(import.meta.dir, '../..')
const APPS = ['auth', 'boards', 'backoffice'] as const

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
