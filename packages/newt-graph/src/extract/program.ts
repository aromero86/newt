import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import ts from 'typescript'

/** The TypeScript program of an application, and the files of it that are the application's own. */
export type AppProgram = {
  program: ts.Program
  checker: ts.TypeChecker
  /** The tsconfig it was read from: the one given, or the project of a solution that holds the root's files. */
  tsconfig: string
  /** The application's own files under the root: neither the framework nor anything in node_modules. */
  files: ts.SourceFile[]
  /** The folder of newt's sources, whose declarations are the framework's. */
  frameworkDir: string
}

const isUnder = (path: string, dir: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep)

function read(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    },
  })
  if (!parsed) throw new Error(`Cannot read ${configPath}`)
  return parsed
}

/**
 * The tsconfig that compiles the root's files: the one given, or else the nearest
 * `tsconfig.json` above the root; a solution (`files: []` with `references`) is
 * followed to the projects that hold files under the root.
 */
function configsFor(root: string, tsconfig?: string): { path: string, parsed: ts.ParsedCommandLine }[] {
  let path = tsconfig ? resolve(tsconfig) : undefined
  if (!path) {
    for (let dir = root; ; dir = dirname(dir)) {
      if (existsSync(join(dir, 'tsconfig.json'))) {
        path = join(dir, 'tsconfig.json')
        break
      }
      if (dirname(dir) === dir) throw new Error(`No tsconfig.json at ${root} or above it: say which with --tsconfig`)
    }
  }
  const parsed = read(path)
  const holds = (each: ts.ParsedCommandLine) => each.fileNames.some(file => isUnder(resolve(file), root))
  if (holds(parsed)) return [{ path, parsed }]
  const referenced = (parsed.projectReferences ?? [])
    .map(reference => ts.resolveProjectReferencePath(reference))
    .map(each => ({ path: each, parsed: read(each) }))
    .filter(each => holds(each.parsed))
  if (referenced.length === 0) throw new Error(`${path} compiles no file under ${root}: say which tsconfig does with --tsconfig`)
  return referenced
}

/** Where newt's sources are, as the application resolves `newt/core`. */
export function findFrameworkDir(root: string, given?: string): string {
  if (given) return realpathSync(resolve(given))
  try {
    return realpathSync(dirname(dirname(Bun.resolveSync('newt/core', root))))
  } catch {
    throw new Error(`Cannot resolve newt/core from ${root}: is newt installed there?`)
  }
}

/** Opens the application's program: every file its tsconfig compiles, type checked lazily. */
export function openProgram(options: { root: string, tsconfig?: string, framework?: string }): AppProgram {
  const root = realpathSync(resolve(options.root))
  const configs = configsFor(root, options.tsconfig)
  const [first] = configs
  const rootNames = [...new Set(configs.flatMap(each => each.parsed.fileNames))]
  const program = ts.createProgram({ rootNames, options: { ...first!.parsed.options, noEmit: true } })
  const frameworkDir = findFrameworkDir(root, options.framework)
  const files = program.getSourceFiles().filter(file => {
    if (file.isDeclarationFile) return false
    const path = resolve(file.fileName)
    return isUnder(path, root) && !path.includes(`${sep}node_modules${sep}`) && !isUnder(path, frameworkDir)
  })
  return { program, checker: program.getTypeChecker(), tsconfig: first!.path, files, frameworkDir }
}

export { isUnder }
