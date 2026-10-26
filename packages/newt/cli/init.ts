import { join } from 'node:path'
import { writeNew } from './write-new'

/** The application's own AGENTS.md: what is its, and where newt's rules are. */
const AGENTS = `# AGENTS.md

Before writing code, read node_modules/newt/AGENTS.md: it is the rules of the
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

/** Claude Code's memory: it imports both, the project's and newt's. */
const CLAUDE = `@AGENTS.md
@node_modules/newt/AGENTS.md
`

const ESLINT = `import { newt } from 'newt-eslint'

// newt's lint. With contexts, say which ones each one uses:
// newt({ contexts: { folder: 'src/contexts', uses: { auth: [], shop: ['auth'] } } })
export default newt()
`

const ESLINT_CONFIGS = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts']

/**
 * Sets an application up for coding agents: an AGENTS.md of its own that sends them to
 * newt's, a CLAUDE.md that imports both, and newt's lint if it has no ESLint
 * configuration. Never overwrites a file: what was there is said and left.
 */
export async function init(cwd: string): Promise<string[]> {
  const files: Record<string, string> = { 'AGENTS.md': AGENTS, 'CLAUDE.md': CLAUDE }
  const eslint = await existing(cwd, ESLINT_CONFIGS)
  if (!eslint) files['eslint.config.js'] = ESLINT
  const { written, skipped } = await writeNew(cwd, files)
  return [
    ...written.map(path => `wrote    ${path}`),
    ...skipped.map(path => `skipped  ${path} (it is there already: left as it was)`),
    ...eslint ? [`skipped  eslint.config.js (${eslint} is there: add newt-eslint's preset to it, \`newt()\`)`] : [],
    '',
    'Next:',
    '  bun add newt zod',
    '  bun add -d newt-eslint eslint typescript@npm:@typescript/typescript6@6.0.2',
    '  fill in AGENTS.md: the project, its contexts, its conventions',
    '  newt add module <context-folder> <module>   e.g. newt add module src/contexts/shop order',
  ]
}

async function existing(cwd: string, names: string[]): Promise<string | undefined> {
  for (const name of names) if (await Bun.file(join(cwd, name)).exists()) return name
  return undefined
}
