import { useEffect } from 'react'
import { useParams } from 'react-router'
import { ArrowUpIcon, WaypointsIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRow } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { CodeBlock } from 'newt-react-ui/code-block'
import { Counter } from 'newt-react-ui/counter'
import { Inline } from 'newt-react-ui/inline'
import { TextLink } from 'newt-react-ui/link'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Table, TableBody, TableCell, TableRow } from 'newt-react-ui/table'
import { Mono, Text } from 'newt-react-ui/text'
import { Waterfall } from 'newt-react-ui/waterfall'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import type { TraceDTO } from '../../../api/traces'
import { formatMs } from '../app-metrics/metrics-format'
import { TraceRow } from '../app-traces/trace-list'
import { AppTraceService } from './app-trace.service'
import { flowRows, type Span } from './trace-flow'

/**
 * One trace, and the flow it is part of: its steps on a timeline, the jobs its events
 * caused unfolded inside it as asked, the traces that caused it unfolded above it, and
 * the step selected said whole. With its own AppTraceService.
 */
export function AppTrace({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppTraceService]}>
      <AppTraceWrapped app={app} />
    </Provide>
  )
}

function AppTraceWrapped({ app }: { app: AppDTO }) {
  const { traceId } = useParams() as { traceId: string }
  const service = useService(AppTraceService)
  const focusId = useValue(service.focus)
  const topId = useValue(service.top)
  const traces = useValue(service.traces)
  const unfolded = useValue(service.unfolded)
  const loading = useValue(service.loading)
  const selected = useValue(service.selected)
  const failure = useValue(service.failure)
  const notFound = useValue(service.notFound)

  useEffect(() => {
    void service.open(traceId)
  }, [service, traceId])

  if (failure && !focusId) return <Alert tone="bad" title="Could not load the trace">{failure}</Alert>
  if (notFound) return <Box label="Trace"><BoxEmpty icon={WaypointsIcon} title="There is no such trace" description="It was not kept, or it is older than its application's retention." /></Box>
  const trace = focusId ? traces[focusId] : undefined
  const top = topId ? traces[topId] : undefined
  if (!trace || !top) return <Skeleton lines={8} />
  const rows = flowRows({ appId: app.id, top, focus: trace.id, traces, unfolded, loading, toggle: id => void service.toggle(id) })
  const span = selected ? traces[selected.traceId]?.spans.find(each => each.id === selected.spanId) ?? null : null
  const otherRuns = trace.runs.filter(run => run.id !== trace.id)

  return (
    <Stack gap={4}>
      <Subhead title={<Mono>{trace.name}</Mono>} description={<TraceOrigin app={app} trace={trace} />} actions={<Inline gap={2} wrap>{trace.forced && <Badge tone="info">Kept: {trace.forced}</Badge>}<TraceBadge trace={trace} /></Inline>} />
      {failure && <Alert tone="bad" title="Could not load a trace of its flow">{failure}</Alert>}
      <Box label="Steps">
        <BoxHeader
          actions={(
            <Inline gap={2}>
              {top.causedBy && <Button size="sm" variant="outline" loading={loading.includes(top.causedBy.id)} onClick={() => void service.unfoldCause()}><ArrowUpIcon aria-hidden />Show what caused {top.id === trace.id ? 'it' : <Mono>{top.name}</Mono>}</Button>}
              {top.id !== trace.id && <Button size="sm" variant="ghost" onClick={() => service.foldCauses()}>Only this trace</Button>}
            </Inline>
          )}
        >
          {top.id === trace.id ? <>Steps <Counter>{trace.spans.length}</Counter></> : <>Its flow, from <Mono>{top.name}</Mono></>}
          {trace.dropped > 0 && <> and {trace.dropped} more, not kept</>}
        </BoxHeader>
        <Waterfall
          label={`Steps of ${top.name}`}
          rows={rows}
          formatMs={formatMs}
          selected={selected ? `${selected.traceId}:${selected.spanId}` : null}
          onSelect={id => service.select(id.slice(0, id.lastIndexOf(':')), id.slice(id.lastIndexOf(':') + 1))}
        />
      </Box>
      {span && <SpanDetail app={app} span={span} trace={traces[selected!.traceId]!} />}
      {otherRuns.length > 0 && (
        <Box label="Other runs">
          <BoxHeader>Its job's other runs <Counter>{otherRuns.length}</Counter></BoxHeader>
          {otherRuns.map(run => <TraceRow key={run.id} appId={app.id} trace={run} />)}
        </Box>
      )}
    </Stack>
  )
}

/** Where it comes from: a request; or a worker's run of a job, for an event a trace told, if kept. */
function TraceOrigin({ app, trace }: { app: AppDTO, trace: TraceDTO }) {
  const when = <>, <RelativeTime date={trace.startedAt} />, in {formatMs(trace.ms)}{trace.actor ? `, by ${trace.actor}` : ''}{Object.entries(trace.scopes).map(([scope, value]) => `, ${scope} ${value}`).join('')}</>
  if (!trace.job) return <>A request{when}</>
  const context = trace.spans.find(each => each.context)?.context ?? ''
  return (
    <>
      Run {trace.job.run} of a worker's job of <TextLink href={`/apps/${app.id}/queues/${context}/${trace.job.queue}`}><Mono>{trace.job.queue}</Mono></TextLink>,
      {' '}for the event <Mono>{trace.job.event}</Mono>
      {trace.causedBy ? <> told by <TextLink href={`/apps/${app.id}/traces/${trace.causedBy.id}`}><Mono>{trace.causedBy.name}</Mono></TextLink></> : ' (the trace that told it was not kept)'}
      {when}
    </>
  )
}

/** How it ended, at a glance. */
function TraceBadge({ trace }: { trace: TraceDTO }) {
  if (trace.outcome?.kind === 'failure') return <Badge tone="bad">Failed: {trace.outcome.code}</Badge>
  if (trace.outcome?.kind === 'error') return <Badge tone="warn">Error: {trace.outcome.code}</Badge>
  if (trace.retried) return <Badge tone="warn">Ran again</Badge>
  return <Badge tone="ok">Went well</Badge>
}

/** The step selected, whole: what it is, how long, what it says of itself, and a failure's message and stack. */
function SpanDetail({ app, span, trace }: { app: AppDTO, span: Span, trace: TraceDTO }) {
  const attributes = Object.entries(span.attributes).filter(([key]) => key !== 'eventId')
  const link = span.kind === 'use-case' && span.context
    ? <TextLink href={`/apps/${app.id}/use-cases/${span.context}/${span.name}`}>Its metrics</TextLink>
    : span.kind === 'event' && span.context ? <TextLink href={`/apps/${app.id}/events/${span.context}/${span.name}`}>The event</TextLink> : undefined
  return (
    <Box label="Step">
      <BoxHeader actions={link}><Mono>{span.name}</Mono></BoxHeader>
      <BoxRow>
        <Text size="sm" tone="muted">
          {KIND_LABELS[span.kind]}{span.context ? ` of ${span.context}` : ''}, in <Mono>{trace.name}</Mono>, {span.kind === 'event' ? `at ${formatMs(span.startMs)}` : `from ${formatMs(span.startMs)} for ${formatMs(span.ms)}`}
          {span.outcome ? `, ended in ${span.outcome.kind === 'failure' ? 'a failure' : 'an error'}: ${span.outcome.code}` : ''}
          {span.kind === 'event' ? `: ${trace.caused.filter(each => each.job?.eventId === span.attributes.eventId).length} of its workers' runs kept, under it` : ''}
        </Text>
      </BoxRow>
      {attributes.length > 0 && (
        <BoxBody flush>
          <Table caption="What it says of itself">
            <TableBody>
              {attributes.map(([key, value]) => (
                <TableRow key={key}>
                  <TableCell>{ATTRIBUTE_LABELS[key] ?? key}</TableCell>
                  <TableCell><Mono>{key === 'commitMs' ? formatMs(Number(value)) : String(value)}</Mono></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoxBody>
      )}
      {span.failure && (
        <BoxBody>
          <Stack gap={2}>
            <Text size="sm" weight="semibold">{span.failure.message}</Text>
            {span.failure.stack && <CodeBlock label="Stack">{span.failure.stack}</CodeBlock>}
          </Stack>
        </BoxBody>
      )}
    </Box>
  )
}

const KIND_LABELS: Record<Span['kind'], string> = {
  'http': 'A request',
  'job': 'A worker\'s run of a job',
  'use-case': 'A use case',
  'attempt': 'A run of its use case',
  'query': 'A query',
  'transaction': 'A transaction',
  'event': 'An event told',
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  query: 'Shape',
  rows: 'Rows',
  runs: 'Runs',
  commitMs: 'Commit',
  'validation.fields': 'Fields found wrong',
}
