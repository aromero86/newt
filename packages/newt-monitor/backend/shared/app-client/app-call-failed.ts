/**
 * Why a call to an application did not answer: nobody there (or not in time), the
 * key refused (a 401), an answer that is not a monitor endpoint's, or a key the
 * monitor could not open.
 */
export type AppCallFailure = 'unreachable' | 'key_rejected' | 'bad_answer' | 'key_unreadable'

export class AppCallFailed extends Error {
  constructor(readonly reason: AppCallFailure, message: string) {
    super(message)
  }
}
