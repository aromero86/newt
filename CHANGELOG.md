# Changelog

What changes for whoever uses the `@newt-kit` packages, newest version first. All of them are
released together, at one version. How a release is made: [`RELEASING.md`](RELEASING.md).

Versions before 0.2.0 have no entry here.

## 0.2.0 (2026-11-07)

### Added

- **Files.** A context keeps files through `base.storage`, private or public, on S3 (or R2, or
  MinIO) with `@newt-kit/newt/adapter-storage-s3`, or in a folder of the server with
  `@newt-kit/newt/adapter-storage-disk`. The client uploads through a signed address, and the
  upload is verified by its bytes. A file may be 1 MB unless a module says otherwise, and an
  address takes exactly the length it was signed for.
- `@newt-kit/newt/port-storage` is the port, with `MemoryStorage` for tests, and
  `@newt-kit/newt/port-storage/contract` has `describeStorageContract`, the suite for an adapter
  of your own.
- Each trip to storage is a span of its trace, of the new kind `storage`, which
  `@newt-kit/monitor` shows.
- `@newt-kit/eslint`: the rule `newt/storage-use-case`. `uploadUrl` is called by `uploadStart`,
  `verifyUpload` by `uploadConfirm` and `signedUrl` by `downloadUrl`, and those use cases call
  them.
- `@newt-kit/react-ui`: `FileButton`, and `Avatar` takes a picture through `src`.

### Changed

- `@newt-kit/react-ui` has a new look: Poppins as its type, now a dependency loaded by its
  theme; a light theme of nearly white paper inked with gruvbox's dark tones; pill badges,
  rounder cards and bars, and larger stats. The dark theme keeps its colours.

### Upgrading

- `newt/storage-use-case` is on as an error in `newt()`'s config, and it reads names, not types.
  Code that does not use `base.storage` is reported too if it has a member called `uploadUrl`,
  `verifyUpload` or `signedUrl` where the rule does not expect it, or a module method named like
  `uploadStart`, `uploadConfirm` or `downloadUrl` that does not make the matching call.
- To use files on S3, the bucket is yours to create, as newt never creates one, and pages reach
  it only if `serve`'s `csp` lets them (`connect-src`, `img-src`).
