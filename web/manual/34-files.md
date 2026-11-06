# Files

A person attaches a PDF to a card, or changes their avatar. The bytes are no row: they are too
big for a database, and the browser should not send them through your server when a bucket can
take them. But who may read a file, and what it belongs to, is still your application's.

So newt splits the two. **Where the bytes are** is a storage adapter the context picks, as it
picks its store. **What a file is** is a module of yours, with an entity like any other. The
database has the last word: bytes are written first and deleted last, so the worst that can
happen is a file nothing points at, which can be swept, and never a row pointing at nothing.

cooper has both kinds. A card's attachments are private to its workspace
(`boards/modules/attachment`), and people's pictures are public (`auth/modules/avatar`): what
follows is theirs, cut short.

## Giving a context its storage

```ts
import { S3Storage, S3PublicStorage } from '@newt-kit/newt/adapter-storage-s3'

const base = new AppBase({
  name: 'boards',
  store,
  storage: {
    private: await S3Storage.open({ bucket: 'acme-private', ...credentials }),
    public: await S3PublicStorage.open({ bucket: 'acme-public', publicUrl: 'https://cdn.acme.com', ...credentials }),
  },
})
```

Private and public are two places, not a flag on each file: a module that holds `PrivateFiles`
has no `url()` to call, so it cannot publish a file by mistake. A context gets either, both or
none; a module asking for one it was not given gets an error, never a place in memory.

A module takes its own part, kept under the context's and its own name, so contexts and
modules sharing a bucket never meet:

```ts
this.files = base.storage.private.in('attachment')   // boards/attachment/…
```

The module holds it, not the repository: a trip to a bucket has no place inside a transaction.

## A bucket is infrastructure

newt never creates one. Creating it, what may read it and how long files last are decisions for
whoever runs it, and an application's credentials should not be able to make them. `open` only
checks the bucket answers, so a wrong name stops the application when it starts, not at the first
file. What it needs:

- **Credentials** that may `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket`.
  Without the last, S3 answers 403 for a file that is not there, instead of 404.
- **CORS** that lets your frontend's origin `PUT`, as the browser sends the file itself.

Your pages must be allowed to reach it too. newt's Content-Security-Policy only lets a page talk to
its own origin, so `serve`'s `csp` adds the bucket to `connect-src`, and where public files are read
from to `img-src`. cooper's `filesPolicy` (`shared/storage/open-storage.ts`) does it. Forget it, and
the browser refuses the upload with nothing in your server's log.

## Uploading

The client asks your API to start, sends the file to the address it gets, and asks your API to
confirm. The bytes never touch your server.

```ts
const { attachment, uploadUrl } = await api.uploadStart(cardId, { filename, contentType: file.type, sizeBytes: file.size })
await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'content-type': file.type } })
await api.uploadConfirm(attachment.id)
```

The rule goes in the schema, and the use cases are named after what they do. `newt/storage-use-case`
keeps those names ([the lint](./b-lint)), so every module reads the same:

```ts
// attachment.schema.ts
export const ATTACHMENT_RULE = { types: ['image/png', 'application/pdf'], maxBytes: 10 * 1024 * 1024 } as const

export const AttachmentStartSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(ATTACHMENT_RULE.types),
  sizeBytes: z.number().int().positive().max(ATTACHMENT_RULE.maxBytes),
})

// attachment.module.ts
@UseCase()
async uploadStart(cardId: string, input: unknown) {
  const parsed = AttachmentStartSchema.parse(input)
  await this.deps.card.get(cardId)                             // may they: a stranger gets a 404
  const attachment = Attachment.start({ cardId, ...parsed })   // pending
  await this.repo.persist(attachment)
  const uploadUrl = await this.files.uploadUrl(attachment.id, {
    expiresIn: 300,
    contentType: parsed.contentType,
    size: parsed.sizeBytes,
    maxBytes: ATTACHMENT_RULE.maxBytes,
  })
  return { attachment: attachment.toDTO(), uploadUrl }
}

@UseCase()
async uploadConfirm(id: string) {
  const attachment = await this.pending(id)
  const refused = await this.files.verifyUpload(attachment.id, {
    contentType: attachment.contentType,
    maxBytes: ATTACHMENT_RULE.maxBytes,
  })
  if (refused) {
    attachment.refuse()                                        // its event: a worker deletes the bytes
    await this.repo.persist(attachment)
    throw new AttachmentRefused(refused)
  }
  attachment.markReady()
  await this.repo.persist(attachment)
  return attachment.toDTO()
}
```

A schedule deletes what stayed pending: uploads someone started and never finished.

### Why `verifyUpload` has the last word

What the client says of a file's type is its word, and S3 does not hold it to it: a client can send
another. `verifyUpload` looks at what came: how long it really is, and its first bytes. A file that
is not what it says is refused: `missing`, `too_large` or `wrong_type`.

### How long a file may be

A file may be 1 MB (`DEFAULT_MAX_UPLOAD_BYTES`) unless the module says otherwise, with `maxBytes` on
`uploadUrl` and on `verifyUpload`. Give both the same one: a file past what `verifyUpload` is told is
refused, whatever the address took.

The client says how long the file is, and `uploadUrl` takes it as `size`. Longer than `maxBytes`, and
no address is signed: `UploadTooLarge`, a 413. Otherwise the address takes exactly that length, on any
adapter. On S3 the length is signed, so the bucket itself refuses any other with a 403, and never
keeps a byte of it. A browser sends the length of a `File` by itself; a stream, whose length is not
said, is refused.

So someone can't fill a bucket with one upload, but they can with many. Give `uploadStart` a rate
limit of its own, and the bucket a lifecycle rule that expires what is left.

A first-bytes check says what a file starts as, not that all of it is sound: a file starting with
`%PDF-` and followed by rubbish passes. To know more, a worker opens it with a library of its own.

A type with no signature (text, CSV, SVG) cannot be told by its bytes. It passes unless they are
those of something known, a program say. So never trust such a file to be harmless.

## Reading

A private file is read through an address the module signs, after asking who may, every time. The
route answers with a redirect, so the bytes do not go through your server either:

```ts
@UseCase()
async downloadUrl(id: string) {
  const attachment = await this.ready(id)                      // may they: a stranger gets a 404
  return this.files.signedUrl(attachment.id, {
    expiresIn: 60,
    contentType: attachment.contentType,
    filename: attachment.filename,
  })
}

// attachment.routes.ts
workspace.get('/attachments/:id/download', async request =>
  Response.redirect(await attachments.downloadUrl(request.params.id), 302))
```

Anyone holding the address can read the file until it expires, so keep it short. To check on every
byte, or hide where files are, serve `files.open(key)` through the route instead.

A public file has one address for good, `files.url(key)`, for a DTO to carry. Give a new file a
new key rather than replacing one: caches keep the old one a while.

**A file someone uploaded must not run on your origin.** Whatever you ask, `inline` is only for
types a browser cannot run (`mayShowInline`); HTML, SVG and everything else are only ever
downloaded. On a bucket's own domain that is one more wall; on disk it is the one that matters.

## Deleting

Deleting an attachment deletes its row; a worker deletes its bytes, from the event:

```ts
attachments.events.removed.subscribe(({ id }) => attachments.removeBytes(id), {
  strategy: 'handler',
  queue: 'attachment.removeBytes.on.attachment.removed',
})
```

`delete` of what is not there is no error, as a job may run twice.

## On the server's own disk

```ts
import { DiskStorage } from '@newt-kit/newt/adapter-storage-disk'

const files = await DiskStorage.open({
  folder: 'data/files',
  baseUrl: 'https://app.acme.com/api/files',
  secret: process.env.FILES_SECRET!,
})

base.http.get('/files/*', files.handler, { public: true })
base.http.put('/files/*', files.handler, { public: true, crossOrigin: true, maxBodyBytes: 20 * 1024 * 1024 })
```

Modules do not change: `uploadUrl` and `signedUrl` give addresses of your own application, signed
and for a while, and `handler` serves them. The routes are public because the signature is what lets
a request in. `maxBodyBytes` must take the longest file any module accepts, as it is what the server
will read. Unlike S3, it holds an upload to its type as well as its length.

In cooper, it is the default: `COOPER_S3_ENDPOINT` moves files to S3, and in production files on disk
need a `COOPER_FILES_SECRET` of their own.

The folder must outlive the application (a persistent volume), and several instances need one they
share. For a small application with one server, it is all it needs.

## What it does not do

Each file goes up in one `PUT`, so 5 GB at most on S3: uploading in parts from the browser is outside
the port. Nor does it transform anything: a thumbnail is a worker's, which reads with `open` and writes
with `put`, like any other file.

## Testing

`MemoryStorage` keeps files in memory, and `send` answers its addresses as a bucket would:

```ts
const storage = new MemoryStorage()
const base = new AppBase({ name: 'boards', store, storage: { private: storage } })

const { attachment, uploadUrl } = await attachments.uploadStart(cardId, input)
await storage.send(uploadUrl, { method: 'PUT', body: png, headers: { 'content-type': 'image/png' } })
await attachments.uploadConfirm(attachment.id)
```

An adapter of your own proves itself with `describeStorageContract`, from `@newt-kit/newt/port-storage/contract`.
