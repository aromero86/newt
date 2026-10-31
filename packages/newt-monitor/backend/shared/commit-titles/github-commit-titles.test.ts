import { afterEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { GitHubCommitTitles } from './github-commit-titles'

let github: Server<undefined> | undefined
let seen: { path: string, authorization: string | null }[] = []

afterEach(async () => {
  await github?.stop(true)
  github = undefined
  seen = []
})

/** A GitHub API that answers each commit as told: a status and, with 200, its message. */
function serveGitHub(answers: Record<string, { status: number, message?: string, limited?: boolean }>) {
  github = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      seen.push({ path: pathname, authorization: request.headers.get('authorization') })
      const answer = answers[pathname.split('/').at(-1)!] ?? { status: 404 }
      const headers = answer.limited ? { 'x-ratelimit-remaining': '0' } : {}
      return answer.status === 200
        ? Response.json({ sha: 'x', commit: { message: answer.message } }, { headers })
        : Response.json({ message: 'Not Found' }, { status: answer.status, headers })
    },
  })
  return github.url.origin
}

describe('GitHubCommitTitles', () => {
  test('gives a commit\'s first line, asking with its token', async () => {
    const api = serveGitHub({ c1: { status: 200, message: 'Cards can be moved\n\nAnd more said below.' } })
    expect(await new GitHubCommitTitles('a-token', api).title('https://github.com/acme/shop', 'c1')).toBe('Cards can be moved')
    expect(seen).toEqual([{ path: '/repos/acme/shop/commits/c1', authorization: 'Bearer a-token' }])
  })

  test('gives none for a commit it does not have or may not read, and asks without a token when it has none', async () => {
    const api = serveGitHub({ c1: { status: 404 }, c2: { status: 403 } })
    const titles = new GitHubCommitTitles(null, api)
    expect(await titles.title('https://github.com/acme/shop', 'c1')).toBeNull()
    expect(await titles.title('https://github.com/acme/shop', 'c2')).toBeNull()
    expect(seen.map(each => each.authorization)).toEqual([null, null])
  })

  test('throws when it could not be asked, to be asked again: an error of GitHub\'s, or too many requests', async () => {
    const api = serveGitHub({ c1: { status: 502 }, c2: { status: 403, limited: true } })
    const titles = new GitHubCommitTitles('a-token', api)
    await expect(titles.title('https://github.com/acme/shop', 'c1')).rejects.toThrow(/502/)
    await expect(titles.title('https://github.com/acme/shop', 'c2')).rejects.toThrow(/403/)
  })
})
