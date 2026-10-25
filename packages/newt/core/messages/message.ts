import { currentMessages } from './current-messages'
import type { Messages } from './messages'

/** The message for `code`, as the application set it. */
export function message<K extends keyof Messages>(code: K, ...params: Parameters<Messages[K]>): string {
  return (currentMessages.value[code] as (...args: Parameters<Messages[K]>) => string)(...params)
}
