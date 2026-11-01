/**
 * What a client receives when a request fails (@newt-kit/newt/http's `toErrorResponse`): the
 * message to show, the code to tell the error by and, for a body that is not valid,
 * what is wrong with it field by field.
 */
export type ErrorBody = {
  error: string
  code: string
  issues?: { path: PropertyKey[], message: string }[]
}
