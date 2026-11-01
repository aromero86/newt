// bun run release:version 0.2.0: every published package to one version. They are released
// together, so each one's newt-kit dependencies are that same version once published.
import { join } from 'node:path'

const version = Bun.argv[2]
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('usage: bun run release:version <x.y.z>')
  process.exit(1)
}

const PACKAGES = ['newt', 'newt-eslint', 'newt-react', 'newt-react-ui', 'newt-monitor']
for (const dir of PACKAGES) {
  const path = join(import.meta.dir, '..', 'packages', dir, 'package.json')
  const manifest = await Bun.file(path).json() as { name: string, version: string, peerDependencies?: Record<string, string> }
  manifest.version = version
  // A peer on another newt-kit package asks for this release or a later one of its line.
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (name.startsWith('newt-kit')) manifest.peerDependencies![name] = `^${version}`
  }
  await Bun.write(path, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`${manifest.name} ${version}`)
}
console.log(`\nNext: commit, then git tag v${version} && git push --follow-tags`)
