import { setMessages, type Messages } from 'newt-kit/core'

/**
 * What cooper says when something newt owns goes wrong, in cooper's words: newt's
 * defaults are plain and right, these speak to the person using the app. Its own
 * errors' messages each module writes itself (`errors/`); the `code` a client acts
 * on never changes.
 */
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  duplicate_value: () => 'That is already taken: pick another one',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'You are not signed in, or your session has ended: sign in to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

/**
 * Sets cooper's messages for the whole process: once, as the server starts
 * (`index.ts`), before any request. Every context answers with them.
 */
export function setCooperMessages(): () => void {
  return setMessages(cooperMessages)
}
