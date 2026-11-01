// @newt-kit/newt/monitor: what an application tells whoever monitors it, on a port of its own,
// only to requests signed with a key both share; and how such a request is signed.

export { serveMonitor } from './serve-monitor'
export { signMonitorRequest } from './sign-monitor-request'
export { signTraceHeader, TRACE_HEADER_MAX_MS } from './trace-header'
export { TRACE_HEADER } from '../core/traces/trace-forcing'
export type { MonitorOptions } from './monitor-options'
export type { MonitorIdentity } from './monitor-identity'
export { MemoryNonces, RedisNonces } from './nonce-store'
export type { NonceStore } from './nonce-store'
