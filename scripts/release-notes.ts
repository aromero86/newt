// bun scripts/release-notes.ts 0.2.0: what CHANGELOG.md says of a version, the notes of its
// GitHub Release. The release workflow runs it too: a version without an entry is not published.
import { join } from 'node:path'

const version = Bun.argv[2]
if (!version) {
  console.error('usage: bun scripts/release-notes.ts <x.y.z>')
  process.exit(1)
}

const changelog = await Bun.file(join(import.meta.dir, '..', 'CHANGELOG.md')).text()
const lines = changelog.split('\n')
const start = lines.findIndex(line => line === `## ${version}` || line.startsWith(`## ${version} `))
const length = lines.slice(start + 1).findIndex(line => line.startsWith('## '))
const notes = lines.slice(start + 1, length === -1 ? undefined : start + 1 + length).join('\n').trim()

if (start === -1 || !notes) {
  console.error(`CHANGELOG.md has no entry for ${version}: write its section, ## ${version} (YYYY-MM-DD)`)
  process.exit(1)
}
console.log(notes)
