/**
 * What a client receives when a route throws: `toErrorResponse` unless a router, a
 * group or a route says otherwise, as OAuth's endpoints do with their own body
 * (`toOauthErrorResponse`). It gets the request too, to answer by what it sent.
 */
export type ErrorHandler = (error: unknown, request: Request) => Response | Promise<Response>
