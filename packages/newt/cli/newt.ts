#!/usr/bin/env bun
// newt's command line: `newt init` sets an application up for coding agents, and
// `newt add module <context-folder> <name>` writes a module's skeleton.

import { addModule } from './add-module'
import { init } from './init'

const USAGE = `newt init
  In an application's folder: an AGENTS.md of its own (which sends agents to
  node_modules/newt/AGENTS.md, here or in a folder above), a CLAUDE.md that
  imports both, and an eslint.config.js with newt's lint if neither this folder
  nor one above has an ESLint configuration. Never overwrites a file.

newt add module <context-folder> <name>
  A module's skeleton in <context-folder>/modules/<name>/, named as newt's lint
  wants: newt add module src/contexts/shop price-change`

/** Runs a command, in `cwd`: what to print, and the exit code. */
export async function run(args: string[], cwd: string): Promise<{ lines: string[], code: number }> {
  const [command, ...rest] = args
  try {
    if (command === 'init' && rest.length === 0) return { lines: await init(cwd), code: 0 }
    if (command === 'add' && rest[0] === 'module' && rest.length === 3) return { lines: await addModule(cwd, rest[1]!, rest[2]!), code: 0 }
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') return { lines: [USAGE], code: 0 }
    return { lines: [USAGE], code: 1 }
  } catch (error) {
    return { lines: [error instanceof Error ? error.message : String(error)], code: 1 }
  }
}

if (import.meta.main) {
  const { lines, code } = await run(Bun.argv.slice(2), process.cwd())
  console[code === 0 ? 'log' : 'error'](lines.join('\n'))
  process.exit(code)
}
