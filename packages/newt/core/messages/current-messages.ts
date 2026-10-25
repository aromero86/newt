import type { Messages } from './messages'

/** The messages in use, for the whole process: English until the application sets its own. */
export const currentMessages: { value: Messages } = {
  value: {
    concurrency_conflict: () => 'Someone changed it in the meantime. Try again.',
    reference_not_found: ({ resource, id }) => `The ${resource} ${id} does not exist`,
    not_signed_in: () => 'Sign in to continue',
    invalid_email: ({ email }) => `'${email}' is not a valid email`,
    route_not_found: ({ method, path }) => `There is no route for ${method} ${path}`,
    method_not_allowed: ({ method, path }) => `${method} is not allowed on ${path}`,
    validation: () => 'The request is not valid',
    internal: () => 'Something went wrong',
  },
}
