import { currentMessages } from './current-messages'
import type { Messages } from './messages'

/**
 * Replaces some of the framework's messages, for the whole process. What it gives back
 * puts the ones before it back: a test that sets its own restores them when it ends.
 */
export function setMessages(messages: Partial<Messages>): () => void {
  const before = currentMessages.value
  currentMessages.value = { ...before, ...messages }
  return () => { currentMessages.value = before }
}
