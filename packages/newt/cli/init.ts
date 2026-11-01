import { readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { writeNew } from './write-new'

/** The application's own AGENTS.md: what is its, and where newt's rules are (`rules`). */
const agents = (rules: string) => `# AGENTS.md

Before writing code, read ${rules}: it is the rules of the
framework, versioned with it. What follows is this project's own.

## This project

<!-- What it is and for whom, in a few lines. -->

## Contexts

<!-- Each context: what it owns, its store, and which contexts it uses (as
eslint.config.js says). -->

## Conventions

<!-- What this project adds to newt's rules: its base, its scopes and tenants, its
ports and adapters, how it names things. -->

## Commands

\`\`\`sh
bun check        # types
bun test         # tests
bunx eslint      # newt's lint
\`\`\`
`

/** Claude Code's memory: it imports the project's, newt's (`rules`), and those of the newt packages it uses (`more`). */
const claude = (rules: string, more: string[] = []) => [`@AGENTS.md`, `@${rules}`, ...more.map(path => `@${path}`), ''].join('\n')

/**
 * What a package made for newt apps says agents need of it, in its package.json:
 * `"newt": { "agents": "AGENTS.md", "skills": ["skills/newt-react-ui"] }`: its rules,
 * which CLAUDE.md imports, and its Claude Code skills, copied into `.claude/skills/`.
 */
type ForAgents = { agents?: string, skills?: string[] }

const ESLINT = `import { newt } from 'newt-kit-eslint'

// newt's lint. With contexts, say which ones each one uses:
// newt({ contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } } })
export default newt()
`

const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts']

const NEWT_AGENTS = 'node_modules/newt-kit/AGENTS.md'

/**
 * Sets an application up for coding agents: an AGENTS.md of its own that sends them to
 * newt's, a CLAUDE.md that imports both (and the rules of every newt package it depends
 * on that has some, as `newt-kit-react-ui`), those packages' skills in `.claude/skills/`,
 * and newt's lint if it has no ESLint configuration. Both are looked for here and in the folders above, as Bun installs
 * and ESLint looks for its configuration: an application inside a monorepo points at
 * the root's node_modules and keeps the root's lint. Never overwrites a file: what was
 * there is said and left.
 */
export async function init(cwd: string): Promise<string[]> {
  const rules = await above(cwd, [NEWT_AGENTS]) ?? NEWT_AGENTS
  const modules = dirname(dirname(rules))
  const packages = await forAgents(cwd, modules)
  const files: Record<string, string> = {
    'AGENTS.md': agents(rules),
    'CLAUDE.md': claude(rules, packages.flatMap(({ name, agents }) => (agents ? [join(modules, name, agents)] : []))),
  }
  for (const { name, skills = [] } of packages) {
    for (const skill of skills) Object.assign(files, await skillFiles(join(cwd, modules, name, skill), join('.claude/skills', skill.split('/').pop()!)))
  }
  const eslint = await above(cwd, ESLINT_CONFIGS)
  if (!eslint) files['eslint.config.js'] = ESLINT
  const { written, skipped } = await writeNew(cwd, files)
  // A CLAUDE.md of its own (\`bun init\` writes one) is left, but it is told what to import.
  const claudeLacks = skipped.includes('CLAUDE.md') && !(await Bun.file(join(cwd, 'CLAUDE.md')).text()).includes(`@${rules}`)
  return [
    ...written.map(path => `wrote    ${path}`),
    ...skipped.map(path => (path === 'CLAUDE.md' && claudeLacks
      ? `skipped  CLAUDE.md (it is there already: add \`@AGENTS.md\` and \`@${rules}\` to it, one per line, so agents read newt's rules)`
      : `skipped  ${path} (it is there already: left as it was)`)),
    ...eslint ? [`skipped  eslint.config.js (${eslint} is there: add newt-kit-eslint's preset to it, \`newt()\`)`] : [],
    '',
    'Next:',
    ...await typescript7(cwd) ? ['  bun remove typescript                      TypeScript 7, as `bun init` adds it: typescript-eslint needs 6 for now'] : [],
    '  bun add newt-kit zod',
    '  bun add -d newt-kit-eslint eslint typescript@npm:@typescript/typescript6@6.0.2',
    '  fill in AGENTS.md: the project, its contexts, its conventions',
    '  newt add module <context-folder> <module>   e.g. newt add module src/contexts/shop order',
  ]
}

/** Whether the application asks for TypeScript 7, which newt's lint cannot run on yet: any \`typescript\` but the 6 it names. */
async function typescript7(cwd: string): Promise<boolean> {
  // \`bun init\` asks for it twice: as a peer, and Bun installs it for typescript-eslint's own peers.
  const manifest = Bun.file(join(cwd, 'package.json'))
  if (!await manifest.exists()) return false
  const { dependencies = {}, devDependencies = {}, peerDependencies = {} } = await manifest.json() as Record<string, Record<string, string> | undefined>
  return [dependencies, devDependencies, peerDependencies].some(each => each?.typescript !== undefined && !each.typescript.includes('typescript6'))
}

/** The newt packages the application depends on that say something to agents, by name. */
async function forAgents(cwd: string, modules: string): Promise<(ForAgents & { name: string })[]> {
  const manifest = Bun.file(join(cwd, 'package.json'))
  if (!await manifest.exists()) return []
  const { dependencies = {}, devDependencies = {} } = await manifest.json() as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
  const found: (ForAgents & { name: string })[] = []
  for (const name of Object.keys({ ...dependencies, ...devDependencies }).sort()) {
    const file = Bun.file(join(cwd, modules, name, 'package.json'))
    if (!await file.exists()) continue
    const { newt } = await file.json() as { newt?: ForAgents }
    if (newt) found.push({ name, ...newt })
  }
  return found
}

/** Every file of a skill's folder, by where it goes in the application. */
async function skillFiles(folder: string, to: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const path of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!path.isFile()) continue
    const file = join(path.parentPath, path.name)
    files[join(to, relative(folder, file))] = await Bun.file(file).text()
  }
  return files
}

/** The first of `names` found in `cwd` or the nearest folder above that has one, as a path from `cwd`. */
async function above(cwd: string, names: string[]): Promise<string | undefined> {
  for (let folder = cwd; ; folder = dirname(folder)) {
    for (const name of names) if (await Bun.file(join(folder, name)).exists()) return relative(cwd, join(folder, name))
    if (dirname(folder) === folder) return undefined
  }
}
