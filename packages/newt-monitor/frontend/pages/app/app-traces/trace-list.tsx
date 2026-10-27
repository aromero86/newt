import { useCallback, useEffect, useState } from 'react'
import { CircleAlertIcon, CircleCheckIcon, CircleXIcon, RepeatIcon, TimerIcon, WaypointsIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Icon } from 'newt-react-ui/icon'
import { Inline } from 'newt-react-ui/inline'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Mono, Text } from 'newt-react-ui/text'
import { useService } from 'newt-react'
import type { MetricsWindow } from '../../../api/event-metrics'
import { TracesApi, type TraceListQueryDTO, type TraceSummaryDTO } from '../../../api/traces'
import { formatMs, WINDOW_LABELS } from '../app-metrics/metrics-format'

type Show = NonNullable<TraceListQueryDTO['show']>

const FILTERS: { show: Show, label: string, icon: typeof CircleXIcon }[] = [
  { show: 'all', label: 'All', icon: WaypointsIcon },
  { show: 'failures', label: 'Failures', icon: CircleXIcon },
  { show: 'errors', label: 'Errors', icon: CircleAlertIcon },
  { show: 'retried', label: 'Ran again', icon: RepeatIcon },
  { show: 'slow', label: 'Slowest', icon: TimerIcon },
]

/** How a trace ended, as an icon: a failure, an error, ran again, or well. */
export function TraceOutcomeIcon({ trace }: { trace: Pick<TraceSummaryDTO, 'outcome' | 'retried'> }) {
  if (trace.outcome?.kind === 'failure') return <Icon icon={CircleXIcon} tone="bad" />
  if (trace.outcome?.kind === 'error') return <Icon icon={CircleAlertIcon} tone="warn" />
  if (trace.retried) return <Icon icon={RepeatIcon} tone="warn" />
  return <Icon icon={CircleCheckIcon} tone="ok" />
}

/** A row of a trace in a list: what it was, when, how it ended, how long. */
export function TraceRow({ appId, trace }: { appId: string, trace: TraceSummaryDTO }) {
  return (
    <BoxRow leading={<TraceOutcomeIcon trace={trace} />} trailing={<Text size="sm" tone="muted" as="span">{formatMs(trace.callMs ?? trace.ms)}</Text>}>
      <BoxRowTitle href={`/apps/${appId}/traces/${trace.id}`}><Mono>{trace.name}</Mono></BoxRowTitle>
      <BoxRowMeta>
        <RelativeTime date={trace.startedAt} />
        {trace.job && <>run {trace.job.run}</>}
        {trace.outcome && <><Mono>{trace.outcome.code}</Mono></>}
        {trace.callMs !== null && <>whole {formatMs(trace.ms)}</>}
        {trace.useCases.length > 0 && <>{trace.useCases.slice(0, 3).join(', ')}{trace.useCases.length > 3 ? `, ${trace.useCases.length - 3} more` : ''}</>}
        {trace.actor && <>by {trace.actor}</>}
      </BoxRowMeta>
    </BoxRow>
  )
}

/**
 * The traces kept of something (a use case, a queue, the whole application), newest
 * first, with a filter for those that failed, ended in an error, ran again, or the slowest.
 */
export function TraceList({ appId, title, query, window = '24h', actions }: { appId: string, title: string, query: Omit<TraceListQueryDTO, 'show' | 'before' | 'window'>, window?: MetricsWindow, actions?: React.ReactNode }) {
  const api = useService(TracesApi)
  const [show, setShow] = useState<Show>('all')
  const [traces, setTraces] = useState<TraceSummaryDTO[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const key = JSON.stringify(query)

  const load = useCallback(async (before?: string) => {
    try {
      const page = await api.list(appId, { ...JSON.parse(key) as typeof query, window, show, before, limit: 20 })
      setTraces(current => (before ? [...current ?? [], ...page.traces] : page.traces))
      setNext(page.next)
      setFailure(null)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not load the traces')
    }
  }, [api, appId, key, window, show])

  useEffect(() => {
    setTraces(null)
    void load()
  }, [load])

  return (
    <Box label={title}>
      <BoxHeader actions={actions}>
        <Inline gap={4} wrap>
          <Text size="sm" weight="semibold" as="span">{title}</Text>
          {FILTERS.map(filter => <BoxFilter key={filter.show} active={show === filter.show} icon={filter.icon} onClick={() => setShow(filter.show)}>{filter.label}</BoxFilter>)}
        </Inline>
      </BoxHeader>
      {failure && <BoxRow><Alert tone="bad" title="Could not load the traces">{failure}</Alert></BoxRow>}
      {!failure && traces === null && <BoxRow><Skeleton lines={3} /></BoxRow>}
      {traces?.length === 0 && <BoxEmpty icon={WaypointsIcon} title={`None in ${WINDOW_LABELS[window]}`} description="Every trace that fails or runs again is kept, and a share of the rest." />}
      {traces?.map(trace => <TraceRow key={trace.id} appId={appId} trace={trace} />)}
      {next && (
        <BoxFooter>
          <Button size="sm" variant="outline" onClick={() => void load(next)}>More</Button>
        </BoxFooter>
      )}
      {traces && traces.length > 0 && show === 'slow' && <BoxRow><Badge tone="muted">The slowest first</Badge></BoxRow>}
    </Box>
  )
}
