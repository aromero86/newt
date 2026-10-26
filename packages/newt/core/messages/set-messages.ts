import { currentMessages } from './current-messages'
import type { Messages } from './messages'

/** Replaces some of the framework's messages, for the whole process. */
export function setMessages(messages: Partial<Messages>): void {
  currentMessages.value = { ...currentMessages.value, ...messages }
}
