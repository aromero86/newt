import { statSync } from 'node:fs'
import { posix, resolve } from 'node:path'

/** A file's path with forward slashes, whatever the system. */
export function slashed(path) {
  return path.replaceAll('\\', '/')
}

/** `price-change` → `priceChange`: a module's name from its folder's. */
export function camelCase(kebab) {
  return kebab.replace(/-(\w)/g, (_, letter) => letter.toUpperCase())
}

/** A folder as an absolute path with forward slashes and no trailing one, whatever the system: a relative one is read from `base`. */
export function absolute(folder, base) {
  return slashed(resolve(base, slashed(folder))).replace(/(?<=.)\/$/, '')
}

/**
 * The project's root, from which a `modules/` folder is read: the one the preset was
 * given (the `root` of its settings for `newt`), or ESLint's cwd without one.
 */
export function rootOf(context) {
  return absolute(context.settings?.newt?.root ?? context.cwd, context.cwd)
}

/** A file's path from the project's `root` (absolute), with a leading slash; the path as it is outside it. */
function inProject(file, root) {
  const path = slashed(file)
  return root && path.startsWith(`${root}/`) ? path.slice(root.length) : path
}

/**
 * Where a file of a module is: its context (the folder that holds `modules/`), its
 * module, and its path inside the module. `null` for a file of no module. The path
 * is read from the project's root (`root`, absolute), so a project that lives inside
 * a folder named `modules` is not mistaken for one; a `modules/` at the project's
 * root has the project itself as its context (`.`).
 */
export function modulePlace(file, root = '') {
  const path = inProject(file, root)
  const top = path !== slashed(file) && /^\/modules\/([^/]+)\/(.+)$/.exec(path)
  if (top) return { context: '.', module: top[1], inside: top[2] }
  const match = /\/([^/]+)\/modules\/([^/]+)\/(.+)$/.exec(path)
  return match ? { context: match[1], module: match[2], inside: match[3] } : null
}

/** Where a file directly in the folder of the contexts is: in no context, and one no context may import. */
export const ROOT = '(root)'

/**
 * The context a path is in, when contexts are the folders of `folder` (absolute):
 * `…/contexts/shop/…` is in `shop`, and so is the folder itself (an import of
 * `../shop`), whether `uses` lists it or not. A file directly in `folder`
 * (`contexts/registry.ts`, or an import of it without its extension) is in `ROOT`.
 * `null` for a path outside it.
 */
export function contextOf(file, folder) {
  const path = slashed(file)
  if (!path.startsWith(`${folder}/`)) return null
  const [name, ...rest] = path.slice(folder.length + 1).split('/')
  if (rest.length > 0 || isFolder(path)) return name
  return /\.[^./]+$/.test(name) || isFile(path) ? ROOT : name
}

function isFolder(path) {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

/** That a file is there, with one of the extensions an import may leave out. */
function isFile(path) {
  return ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].some(extension => statSync(`${path}${extension}`, { throwIfNoEntry: false })?.isFile())
}

/** The file a relative import points at. */
export function target(file, specifier) {
  return posix.normalize(posix.join(posix.dirname(slashed(file)), specifier))
}

/**
 * The file an import points at, without the extension it may be written with
 * (`./product.module.js`): a relative one from the importing file, an alias by the
 * `paths` of the project's tsconfig, read from the program typescript-eslint builds
 * (so only when it builds one: the preset does). `null` for a package.
 */
export function resolved(context, specifier) {
  const path = specifier.startsWith('.') ? target(context.filename, specifier) : aliased(context, specifier)
  return path?.replace(/\.[cm]?[jt]sx?$/, '') ?? null
}

/** The file an alias of the tsconfig's `paths` points at: the first one it lists, by the longest pattern that matches, as TypeScript does. */
function aliased(context, specifier) {
  const options = context.sourceCode.parserServices?.program?.getCompilerOptions()
  const base = options?.pathsBasePath ?? options?.baseUrl
  if (!base || !options.paths) return null
  const matches = Object.entries(options.paths).flatMap(([pattern, [first]]) => {
    const [prefix, suffix] = pattern.split('*')
    if (suffix === undefined) return pattern === specifier ? [{ prefix, path: first }] : []
    const fits = specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length
    return fits ? [{ prefix, path: first.replace('*', specifier.slice(prefix.length, specifier.length - suffix.length)) }] : []
  })
  const [best] = matches.sort((a, b) => b.prefix.length - a.prefix.length)
  return best ? posix.normalize(posix.join(slashed(base), best.path)) : null
}

/**
 * The visitor of every way a file names another: `import` and `export … from`,
 * `import()` (an expression or a type), `import x = require()` and `require()`.
 * `check` gets the node and the path, when it is written as a plain string.
 */
export function importsOf(check) {
  const named = node => {
    if (node?.type === 'Literal' && typeof node.value === 'string') check(node, node.value)
    else if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) check(node, node.quasis[0].value.cooked)
  }
  return {
    ImportDeclaration: node => named(node.source),
    ExportNamedDeclaration: node => named(node.source),
    ExportAllDeclaration: node => named(node.source),
    ImportExpression: node => named(node.source),
    TSImportType: node => named(node.source ?? node.argument?.literal),
    TSExternalModuleReference: node => named(node.expression),
    "CallExpression[callee.type='Identifier'][callee.name='require']": node => named(node.arguments[0]),
  }
}
