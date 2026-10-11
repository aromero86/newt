/** Who is doing what is being done: a user, through one of their sessions or an access token. */
export type Actor = {
  userId: string
  /** The browser session it came through; null through an access token. */
  sessionId: string | null
  /** The AI assistant acting for the user, by the name it gives itself (`claude-code`); absent when it is the person. */
  assistant?: string
}
