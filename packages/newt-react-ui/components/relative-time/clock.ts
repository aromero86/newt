const listeners = new Set<() => void>()
let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined

/** The time, a minute at most behind: it ticks once a minute while anything subscribes. */
export const clock = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    timer ??= setInterval(() => {
      now = Date.now()
      for (const each of listeners) each()
    }, 60_000)
    return () => {
      listeners.delete(listener)
      if (listeners.size > 0) return
      clearInterval(timer)
      timer = undefined
    }
  },
  snapshot() {
    // Nothing ticked while no one was subscribed: catch up before the first render reads it.
    if (!timer && Date.now() - now >= 60_000) now = Date.now()
    return now
  },
  serverSnapshot: () => Date.now(),
}
