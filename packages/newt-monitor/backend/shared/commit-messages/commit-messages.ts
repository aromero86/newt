/** A commit's message: its first line, and what follows it (null when nothing does). */
export type CommitMessage = { title: string, description: string | null }

/**
 * A commit's message, as its repository tells it: null when the repository does not
 * have it, or does not let the monitor read it. Throws when it could not be asked
 * (nobody answered, too many requests), to be asked again.
 */
export interface CommitMessages {
  message(repository: string, commit: string): Promise<CommitMessage | null>
}
