import type { CommitTitles } from './commit-titles'

/** How long it waits for GitHub. */
const TIMEOUT_MS = 10_000

/**
 * `CommitTitles` from GitHub's API: with a token (read access to the repository's
 * contents) a private repository's commits too, without one only a public one's.
 */
export class GitHubCommitTitles implements CommitTitles {

  constructor(private readonly token: string | null, private readonly api = 'https://api.github.com') {}

  async title(repository: string, commit: string): Promise<string | null> {
    const path = new URL(repository).pathname.replace(/^\/+|\/+$/g, '')
    const response = await fetch(`${this.api}/repos/${path}/commits/${encodeURIComponent(commit)}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // Not there, or not to be read with this token: asking again would say the same.
    if ([401, 403, 404, 422].includes(response.status) && response.headers.get('x-ratelimit-remaining') !== '0') return null
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}@${commit}`)
    const body = await response.json() as { commit?: { message?: unknown } }
    const message = typeof body.commit?.message === 'string' ? body.commit.message : ''
    return message.split('\n')[0]!.trim() || null
  }
}
