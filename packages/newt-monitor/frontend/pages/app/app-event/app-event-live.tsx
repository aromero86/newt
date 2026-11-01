import { useEffect, useState } from 'react'
import { Badge } from 'newt-kit-react-ui/badge'
import { liveMetricsUrl, type EventCount } from '../../../api/event-metrics'

const minuteNow = () => new Date(Date.now() - (Date.now() % 60_000)).toISOString()

/** How many times it was told this minute, as it happens: from the application, live. */
export function AppEventLive({ appId, context, event }: { appId: string, context: string, event: string }) {
  const [state, setState] = useState<{ status: 'connecting' | 'live' | 'off', minute: string, count: number, message?: string }>({ status: 'connecting', minute: minuteNow(), count: 0 })

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const source = new EventSource(liveMetricsUrl(appId))
    source.onopen = () => setState(current => ({ ...current, status: 'live' }))
    source.onmessage = message => {
      const told = (JSON.parse(message.data) as EventCount[]).filter(count => count.context === context && count.event === event)
      setState(current => {
        const minute = minuteNow()
        const base = current.minute === minute ? current.count : 0
        return { status: 'live', minute, count: base + told.filter(count => count.minute === minute).reduce((sum, count) => sum + count.count, 0) }
      })
    }
    source.addEventListener('error', error => {
      // The server's own error (archived, or not answering) ends the stream for good: reconnecting would only ask again.
      if (error instanceof MessageEvent && typeof error.data === 'string') {
        source.close()
        const { message } = JSON.parse(error.data) as { message?: string }
        setState(current => ({ ...current, status: 'off', message }))
        return
      }
      setState(current => ({ ...current, status: 'off' }))
    })
    // A new minute starts at zero, even if nothing is told in it.
    const tick = setInterval(() => setState(current => (current.minute === minuteNow() ? current : { ...current, minute: minuteNow(), count: 0 })), 5_000)
    return () => {
      source.close()
      clearInterval(tick)
    }
  }, [appId, context, event])

  if (state.status === 'off') return <Badge tone="muted">{state.message ? `Not live · ${state.message}` : 'Not live'}</Badge>
  if (state.status === 'connecting') return <Badge tone="muted">Connecting…</Badge>
  return <Badge tone="ok">Live · {state.count.toLocaleString('en')} this minute</Badge>
}
