import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

const PDF = new TextEncoder().encode('%PDF-1.7\nsome pages\n%%EOF')
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0])

describe('attachment', () => {
  let t: TestBoards
  let cardId: string
  let time: number

  beforeEach(async () => {
    time = Date.parse('2026-01-01T10:00:00Z')
    t = await openTestBoards({ now: () => new Date(time) })
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'carl')
    cardId = await inAcme(async () => {
      const board = await t.modules.board.create({ name: 'Roadmap' })
      const column = await t.modules.column.add(board.id, { name: 'To do' })
      return (await t.modules.card.create(board.id, { columnId: column.id, title: 'A card' })).id
    })
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const start = (contentType = 'application/pdf', sizeBytes = PDF.byteLength) =>
    inAcme(() => t.modules.attachment.uploadStart(cardId, { filename: 'plan.pdf', contentType, sizeBytes }))
  const send = (uploadUrl: string, body: Uint8Array<ArrayBuffer> | string, contentType = 'application/pdf') =>
    t.storage.send(uploadUrl, { method: 'PUT', body, headers: { 'content-type': contentType } })
  const kept = (id: string) => t.storage.stat(`boards/attachment/${id}`)
  /** A file uploaded and accepted. */
  async function attached(body: Uint8Array<ArrayBuffer> = PDF) {
    const { attachment, uploadUrl } = await start()
    await send(uploadUrl, body)
    return inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))
  }

  test('a real PDF is accepted, as long as it really is', async () => {
    const attachment = await attached()

    expect(attachment.status).toBe('ready')
    expect(attachment.sizeBytes).toBe(PDF.byteLength)
    expect(await inAcme(() => t.modules.attachment.listForCard(cardId))).toEqual([attachment])
  })

  test('something else called a PDF is refused, and its bytes go', async () => {
    const { attachment, uploadUrl } = await start()
    await send(uploadUrl, 'just some text, named plan.pdf')

    await expect(inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).rejects.toThrow('not what it says')
    await t.settled()

    expect(await kept(attachment.id)).toBeNull()
    expect(await inAcme(() => t.modules.attachment.listForCard(cardId))).toEqual([])
  })

  test('a program called a text file is refused too', async () => {
    const { attachment, uploadUrl } = await start('text/plain')
    await send(uploadUrl, new Uint8Array([0x4D, 0x5A, 0x90, 0, 3]), 'text/plain')

    await expect(inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).rejects.toThrow('not what it says')
  })

  test('a file longer than it may be is refused by what came, whatever the client said', async () => {
    const { attachment, uploadUrl } = await start()
    const long = new Uint8Array(10 * 1024 * 1024 + 1)
    long.set(PDF)
    await send(uploadUrl, long)

    await expect(inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).rejects.toThrow('too long')
  })

  test('confirming what never came is refused', async () => {
    const { attachment } = await start()

    await expect(inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).rejects.toThrow('never arrived')
  })

  test('a type it does not take is refused before anything is signed', async () => {
    await expect(start('text/html')).rejects.toThrow()
    await expect(start('image/svg+xml')).rejects.toThrow()
  })

  test('confirming twice is the same as once', async () => {
    const attachment = await attached()

    expect((await inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).status).toBe('ready')
  })

  test('what is not confirmed cannot be read', async () => {
    const { attachment, uploadUrl } = await start()
    await send(uploadUrl, PDF)

    await expect(inAcme(() => t.modules.attachment.downloadUrl(attachment.id))).rejects.toThrow('no attachment')
  })

  test('a signed address gives the file back under its name, only to download', async () => {
    const attachment = await attached()

    const response = await t.storage.send(await inAcme(() => t.modules.attachment.downloadUrl(attachment.id)))

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF)
    expect(response.headers.get('content-disposition')).toStartWith('attachment; filename="plan.pdf"')
  })

  test('another workspace cannot see, confirm, read or remove it', async () => {
    const attachment = await attached()
    const inGlobex = <T>(fn: () => Promise<T>) => t.as('carl', 'globex', fn)

    await expect(inGlobex(() => t.modules.attachment.downloadUrl(attachment.id))).rejects.toThrow('no attachment')
    await expect(inGlobex(() => t.modules.attachment.uploadConfirm(attachment.id))).rejects.toThrow('no attachment')
    await expect(inGlobex(() => t.modules.attachment.remove(attachment.id))).rejects.toThrow('no attachment')
    await expect(inGlobex(() => t.modules.attachment.listForCard(cardId))).rejects.toThrow('no card')
    await expect(inGlobex(() => t.modules.attachment.uploadStart(cardId, { filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 }))).rejects.toThrow('no card')
  })

  test('removing it takes the row at once and the bytes from a worker', async () => {
    const attachment = await attached()

    await inAcme(() => t.modules.attachment.remove(attachment.id))
    expect(await inAcme(() => t.modules.attachment.listForCard(cardId))).toEqual([])
    await t.settled()

    expect(await kept(attachment.id)).toBeNull()
  })

  test('a card that goes takes its files with it', async () => {
    const attachment = await attached()

    await inAcme(() => t.modules.card.delete(cardId))
    await t.settled()

    expect(await kept(attachment.id)).toBeNull()
  })

  test('a workspace that goes takes its files with it', async () => {
    const attachment = await attached()

    await t.auth.deleteWorkspace('acme')
    await t.settled()

    expect(await kept(attachment.id)).toBeNull()
  })

  test('a card has no more than its share, at once or not', async () => {
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => start()))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(20)
    await expect(start()).rejects.toThrow('20 files at most')
  })

  test('an upload never finished is swept, once it is old', async () => {
    const { attachment, uploadUrl } = await start()
    await send(uploadUrl, PDF)

    await t.modules.attachment.sweepPending()
    expect(await kept(attachment.id)).not.toBeNull()

    time += 2 * 60 * 60 * 1000
    await t.modules.attachment.sweepPending()
    await t.settled()

    expect(await kept(attachment.id)).toBeNull()
  })

  test('a png can be attached as well', async () => {
    const { attachment, uploadUrl } = await start('image/png', PNG.byteLength)
    await send(uploadUrl, PNG, 'image/png')

    expect((await inAcme(() => t.modules.attachment.uploadConfirm(attachment.id))).status).toBe('ready')
  })
})
