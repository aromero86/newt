import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Boards_Context } from './boards.context'

describe('boards, through its API', () => {
  let folder: string
  let boards: Boards_Context
  let server: Server<undefined>

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
    boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
    server = serve(boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await boards.stop()
    await rm(folder, { recursive: true, force: true })
  })

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
