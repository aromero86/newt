import { defineScope } from '../scope/define-scope'
import type { Clock } from './clock'

/** The clock of the context whose use case is running: each invocation enters its own. */
export const currentClock = defineScope<Clock>('clock')
