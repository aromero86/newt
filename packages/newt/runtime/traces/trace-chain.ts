import type { Trace } from '../../core/traces/trace'

/**
 * The traces not kept, held a while in case one of their chain is, and the events of
 * the traces kept, whose jobs are kept too: what `keepChain` asks of where traces are.
 */
export interface HeldTraces {
  /** Holds a trace not kept: found by the events it told, and by the event its job ran for. */
  hold(trace: Trace): Promise<void>
  /** Takes out the held traces of the jobs an event caused. */
  takeCaused(eventId: string): Promise<Trace[]>
  /** Takes out the held trace that told an event. */
  takeTeller(eventId: string): Promise<Trace | null>
  /** Remembers that these events' traces are kept: the jobs they cause will be. */
  mark(eventIds: string[]): Promise<void>
  isMarked(eventId: string): Promise<boolean>
}

/**
 * A finished trace, kept with its chain: kept when it is `wanted` or its job ran for
 * an event of a trace kept; then the traces held of its chain are kept with it, the
 * jobs its events caused and the trace that told its job's event, and theirs in turn.
 * One not kept that told events or ran a job is held instead, for one of its chain to
 * keep. So a flow is whole: a request whose job failed later is kept with it.
 */
export async function keepChain(trace: Trace, wanted: boolean, held: HeldTraces, keep: (trace: Trace) => void | Promise<void>): Promise<void> {
  const kept = wanted || (trace.job !== null && await held.isMarked(trace.job.eventId))
  if (!kept) {
    if (trace.told.length > 0 || trace.job) await held.hold(trace)
    return
  }
  const seen = new Set<string>()
  const pending = [trace]
  for (let next = pending.pop(); next; next = pending.pop()) {
    if (seen.has(next.id)) continue
    seen.add(next.id)
    await keep(next)
    await held.mark(next.told.map(event => event.id))
    for (const event of next.told) pending.push(...await held.takeCaused(event.id))
    if (next.job) {
      const teller = await held.takeTeller(next.job.eventId)
      if (teller) pending.push(teller)
    }
  }
}
