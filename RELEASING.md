# Releasing

The five packages are published to npm together, at one version:

| Package | Folder |
|---|---|
| `@newt-kit/newt` | `packages/newt` |
| `@newt-kit/eslint` | `packages/newt-eslint` |
| `@newt-kit/react-ui` | `packages/newt-react-ui` |
| `@newt-kit/react` | `packages/newt-react` |
| `@newt-kit/monitor` | `packages/newt-monitor` |

Each one ships its TypeScript as it is, and `@newt-kit/monitor` its frontend built. What goes in
is each `package.json`'s `files`: no tests, no fixtures, no `tsconfig.json`.

## A release

A GitHub Release is what publishes. A tag alone publishes nothing, and every release has its
section in [`CHANGELOG.md`](CHANGELOG.md), which is also the text of the Release.

```sh
bun run release:version 0.2.0        # every package to 0.2.0
# write the section ## 0.2.0 (YYYY-MM-DD) in CHANGELOG.md
git commit -am "Release 0.2.0"
git push                             # on main

bun scripts/release-notes.ts 0.2.0 |
  gh release create v0.2.0 --target main --title v0.2.0 --notes-file -
```

Publishing the Release creates the tag `v0.2.0` and runs `.github/workflows/release.yml`: it
checks that the tag is the packages' version and that the changelog has its section, type
checks, tests, lints, builds the monitor's frontend and stages each package, the ones others
depend on first: `bun pm pack` turns `workspace:*` into the version it packs, and
`npm stage publish` leaves the tarball waiting on npm. A draft Release runs nothing until it
is published.

## The changelog

`CHANGELOG.md` is written for someone who uses the packages, newest version first: what they
can do now, what changed and what they must do to upgrade. Each section is written by hand
when the release is made, from `git log v<previous>..HEAD`, and is not a list of commits.
Changes to the site, the docs or cooper alone stay out.

It needs one repository secret, `NPM_TOKEN`: an npm granular access token with read and
write on the `@newt-kit` packages. The `npm-token` workflow, run by hand, says whether it still
signs in and may write them, publishing nothing.

The token may only stage (read and write, stage only): nothing it sends is published until a
maintainer approves it. Once the run is green, approve the five packages, dependencies first,
on npmjs.com (Staged Packages, in the account's menu) or from a terminal signed in to npm:

```sh
npm stage list @newt-kit/newt        # its stage id
npm stage approve <stage-id>         # asks for the account's second factor
```

Until then no one can install them. Even a stolen token publishes nothing that nobody approved.

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
