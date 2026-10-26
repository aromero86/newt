import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * What an application may tell newt-graph, in `newt-graph.config.{ts,js,json}` at the
 * folder it runs in (or `--config`). All of it is optional: the root, the tsconfig
 * and which contexts use which are found on their own when they can be.
 */
export type GraphConfig = {
  /** The folder of the backend: where the contexts and modules are. */
  root?: string
  /** The tsconfig that compiles it. */
  tsconfig?: string
  /** Analyse tests and `testing/` helpers too (the page hides them unless asked). */
  tests?: boolean
  /** Which contexts each one may use; read from newt-eslint's `contexts` in `eslint.config.js` when not given. */
  uses?: Record<string, string[]>
  /** The application's name, on the page. */
  name?: string
}

const CONFIG_FILES = ['newt-graph.config.ts', 'newt-graph.config.js', 'newt-graph.config.mjs', 'newt-graph.config.json']
const ESLINT_FILES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts']

export async function loadConfig(cwd: string, given?: string): Promise<{ config: GraphConfig, path: string | null }> {
  const path = given ? resolve(cwd, given) : CONFIG_FILES.map(each => join(cwd, each)).find(existsSync)
  if (!path) return { config: {}, path: null }
  if (!existsSync(path)) throw new Error(`No config at ${path}`)
  const loaded = path.endsWith('.json') ? await Bun.file(path).json() : (await import(pathToFileURL(path).href)).default
  const config = (typeof loaded === 'function' ? await loaded() : loaded) as GraphConfig
  // Paths in a config file are the file's own folder's.
  const base = dirname(path)
  return {
    config: { ...config, root: config.root && resolve(base, config.root), tsconfig: config.tsconfig && resolve(base, config.tsconfig) },
    path,
  }
}

/**
 * newt-eslint's `contexts` in the application's `eslint.config.js`, if it has them:
 * its rule `newt/context-boundaries` says where the contexts are and which ones each
 * uses. Nothing when there is no such file or it cannot be loaded.
 */
export async function contextsFromEslint(cwd: string): Promise<{ folder: string, uses: Record<string, string[]> } | null> {
  const path = ESLINT_FILES.map(each => join(cwd, each)).find(existsSync)
  if (!path) return null
  try {
    const loaded = (await import(pathToFileURL(path).href)).default
    const configs: unknown[] = Array.isArray(loaded) ? loaded.flat(Infinity) : [loaded]
    for (const each of configs) {
      const rule = (each as { rules?: Record<string, unknown> } | null)?.rules?.['newt/context-boundaries']
      const options = Array.isArray(rule) ? rule[1] as { folder?: string, uses?: Record<string, string[]> } | undefined : undefined
      if (options?.uses) return { folder: resolve(cwd, options.folder ?? '.'), uses: options.uses }
    }
  } catch {
    // An eslint config that does not load here (a plugin missing) only means no `uses`.
  }
  return null
}
