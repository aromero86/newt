// bun web/scripts/check-tutorial.ts: checks that the guides show the code they build.
//
// Chapter NN of the guide takes cooper to the tag `tutorial/NN`; chapter NN of the
// monitor's guide takes newt-monitor to `monitor/NN`. Every block of a file in it
// starts with that file's path (`// cooper/…`, `// packages/newt-monitor/…`, `-- …` in
// SQL) and must be in the file at the chapter's tag: a whole file equal to it, or a
// part of it whose pieces, split on `// …` lines, are each in it. An appendix shows the
// finished code, at HEAD. Both languages are checked. Every export of newt must be
// named in some page.
import { $ } from 'bun'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = join(import.meta.dir, '../..')
/** Each guide's folders, and the prefix of its chapters' tags. */
const guides = [
  { folder: 'web/guide', tags: 'tutorial' },
  { folder: 'web/es/guide', tags: 'tutorial' },
  { folder: 'web/monitor', tags: 'monitor' },
  { folder: 'web/es/monitor', tags: 'monitor' },
]
const BLOCK = /```(?:ts|tsx|sql|js|json)\n(?:\/\/|--) ((?:cooper|packages\/newt-monitor)\/[^\n]+)\n([\s\S]*?)\n```/g
const SEPARATOR = /(?:^|\n)[ \t]*(?:\/\/|--) …[ \t]*(?:\n|$)/

const files = new Map<string, string | undefined>()
async function show(ref: string, path: string): Promise<string | undefined> {
  const key = `${ref}:${path}`
  if (!files.has(key)) {
    const read = await $`git -C ${root} show ${key}`.quiet().nothrow()
    files.set(key, read.exitCode === 0 ? read.stdout.toString().replace(/\n$/, '') : undefined)
  }
  return files.get(key)
}

const problems: string[] = []
let blocks = 0
const pages: string[] = []

for (const { folder, tags } of guides) {
  for (const name of (await readdir(join(root, folder))).filter(each => each.endsWith('.md')).sort()) {
    const text = await Bun.file(join(root, folder, name)).text()
    pages.push(text)
    // Outside code, a line that starts with `<` is HTML to the site's Vue compiler, which then fails to build.
    let fenced = false
    for (const [index, line] of text.split('\n').entries()) {
      if (line.trimStart().startsWith('```')) fenced = !fenced
      else if (!fenced && /^\s*<[A-Za-z/]/.test(line)) problems.push(`${folder}/${name}:${index + 1}: a line starts with \`<\`, which the site reads as HTML: move it into the line before`)
    }
    const chapter = /^(\d\d)-/.exec(name)?.[1]
    const ref = chapter ? `${tags}/${chapter}` : 'HEAD'
    for (const [, path, body] of text.matchAll(BLOCK) as IterableIterator<[string, string, string]>) {
      blocks++
      const file = await show(ref, path)
      if (file === undefined) {
        problems.push(`${folder}/${name}: ${path} is not in ${ref}`)
        continue
      }
      if (file === body) continue
      for (const piece of body.split(SEPARATOR).map(each => each.replace(/^\n+|\n+$/g, ''))) {
        if (piece.trim() && !file.includes(piece)) problems.push(`${folder}/${name}: a part of ${path} is not in it at ${ref}:\n${piece}`)
      }
    }
  }
}

// Every export of every entry is named in some page (the index, appendix E, counts too).
const exportsOf = async (entry: string): Promise<string[]> => {
  const index = await Bun.file(join(root, 'packages/newt', entry, 'index.ts')).text()
  return [...index.matchAll(/export (?:type )?\{([^}]+)\}/g)]
    .flatMap(([, names]) => names!.split(','))
    .map(each => each.trim().replace(/^type /, '').split(/\s+as\s+/).pop()!)
    .filter(Boolean)
}
const pkg = await Bun.file(join(root, 'packages/newt/package.json')).json() as { exports: Record<string, unknown> }
const all = pages.join('\n')
for (const entry of Object.keys(pkg.exports).map(each => each.replace(/^\.\/?/, '')).filter(Boolean)) {
  for (const name of await exportsOf(entry)) {
    if (!new RegExp(`\\b${name}\\b`).test(all)) problems.push(`newt/${entry}: ${name} is named in no page of the guide`)
  }
}

for (const problem of problems) console.log(`${problem}\n`)
console.log(problems.length ? `${problems.length} problem(s) in ${blocks} blocks` : `ok: ${blocks} blocks`)
process.exit(problems.length ? 1 : 0)
