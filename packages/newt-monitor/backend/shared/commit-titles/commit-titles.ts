/**
 * The title of a commit (its message's first line), as its repository tells it: null
 * when the repository does not have it, or does not let the monitor read it. Throws
 * when it could not be asked (nobody answered, too many requests), to be asked again.
 */
export interface CommitTitles {
  title(repository: string, commit: string): Promise<string | null>
}
