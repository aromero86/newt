/** A failed request: the backend's status, message and error `code`. Status 0 is no answer at all. */
export class ApiError extends Error {

  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
