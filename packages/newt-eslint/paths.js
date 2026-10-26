import { posix } from 'node:path'

/** A file's path with forward slashes, whatever the system. */
export function slashed(path) {
  return path.replaceAll('\\', '/')
}

/** `price-change` → `priceChange`: a module's name from its folder's. */
export function camelCase(kebab) {
  return kebab.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
}

/**
 * Where a file of a module is: its context (the folder that holds `modules/`), its
 * module, and its path inside the module. `null` for a file of no module. The path
 * is read from the project's root (`cwd`), so a project that lives inside a folder
 * named `modules` is not mistaken for one.
 */
export function modulePlace(file, cwd = '') {
  const root = slashed(cwd).replace(/\/$/, '')
  const path = slashed(file)
  const inProject = root && path.startsWith(`${root}/`) ? path.slice(root.length) : path
  const match = /\/([^/]+)\/modules\/([^/]+)\/(.+)$/.exec(inProject)
  return match ? { context: match[1], module: match[2], inside: match[3] } : null
}

/** The file a relative import points at, as a path without extension. */
export function target(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(slashed(file)), specifier))
}
