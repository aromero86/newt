// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'
import { FakeAuth } from './contexts/boards/testing/fake-auth'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()

// For now auth is a fake one, in memory: ana is in acme, bea in globex (chapter 17 brings the real one).
const auth = await FakeAuth.open()
auth.join('acme', 'ana')
auth.join('globex', 'bea')

// For now each card's move is a line on the console (chapter 28 writes it only while tracing).
const boards = await Boards_Context.open(config.boards, { workspaces: auth.workspaces, log: line => console.log(line) })
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId, via: 'web' as const } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
