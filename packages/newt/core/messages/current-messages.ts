import type { Messages } from './messages'

/** The messages in use, for the whole process: English until the application sets its own. */
export const currentMessages: { value: Messages } = {
  value: {
    concurrency_conflict: () => 'Someone changed it in the meantime. Try again.',
    duplicate_value: ({ fields }) => (fields.length ? `There is already one with this ${fields.join(' and ')}` : 'There is already one like it'),
    reference_not_found: ({ resource, id }) => `The ${resource} ${id} does not exist`,
    not_signed_in: () => 'Sign in to continue',
    invalid_email: ({ email }) => `'${email}' is not a valid email`,
    invalid_secret_token: () => 'The token is not valid',
    route_not_found: ({ method, path }) => `There is no route for ${method} ${path}`,
    method_not_allowed: ({ method, path }) => `${method} is not allowed on ${path}`,
    validation: () => 'The request is not valid',
    malformed_body: () => 'The body of the request cannot be read',
    unsupported_media_type: () => 'The body of the request must be sent as application/json',
    filter_too_deep: ({ max }) => `A filter nests at most ${max} groups deep`,
    filter_too_many_conditions: ({ max }) => `A filter has at most ${max} conditions`,
    internal: () => 'Something went wrong',
  },
}
