# Releasing

The five packages are published to npm together, at one version:

| Package | Folder |
|---|---|
| `newt-kit` | `packages/newt` |
| `newt-kit-eslint` | `packages/newt-eslint` |
| `newt-kit-react-ui` | `packages/newt-react-ui` |
| `newt-kit-react` | `packages/newt-react` |
| `newt-kit-monitor` | `packages/newt-monitor` |

Each one ships its TypeScript as it is, and `newt-kit-monitor` its frontend built. What goes in
is each `package.json`'s `files`: no tests, no fixtures, no `tsconfig.json`.

## A release

```sh
bun run release:version 0.2.0        # every package to 0.2.0
git commit -am "Release 0.2.0"
git tag v0.2.0
git push --follow-tags
```

The tag runs `.github/workflows/release.yml`: it checks that the tag is the packages' version,
type checks, tests, lints, builds the monitor's frontend and publishes each package, the ones
others depend on first. `bun publish` turns `workspace:*` into the version it publishes.

It needs one repository secret, `NPM_TOKEN`: an npm granular access token with read and
write on the `newt-kit` packages.

## By hand

The first release, or one without the workflow, from a machine signed in to npm
(`bunx npm login`):

```sh
bun install && bun run typecheck && bun run test && bun run lint
bun run monitor:build
for dir in newt newt-eslint newt-react-ui newt-react newt-monitor; do
  (cd packages/$dir && bun publish --access public)
done
```

`bun publish --dry-run` in a package's folder lists what would be published, without publishing.
