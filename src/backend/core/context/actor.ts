/** Who is doing what is being done: the signed-in user, through one of their sessions. */
export type Actor = {
  userId: string
  sessionId: string
}
