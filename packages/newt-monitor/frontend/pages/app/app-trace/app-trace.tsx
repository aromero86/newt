import { useEffect } from 'react'
import { useParams } from 'react-router'
import { WaypointsIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRow } from 'newt-react-ui/box'
import { CodeBlock } from 'newt-react-ui/code-block'
import { Counter } from 'newt-react-ui/counter'
import { TextLink } from 'newt-react-ui/link'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Table, TableBody, TableCell, TableRow } from 'newt-react-ui/table'
import { Mono, Text } from 'newt-react-ui/text'
import { Waterfall, type WaterfallRow, type WaterfallTone } from 'newt-react-ui/waterfall'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import type { TraceDTO } from '../../../api/traces'
import { formatMs } from '../app-metrics/metrics-format'
import { TraceRow } from '../app-traces/trace-list'
import { AppTraceService } from './app-trace.service'

type Span = TraceDTO['spans'][number]

/** One trace: each step on a timeline, the one selected said whole, and the traces it is linked to. With its own AppTraceService. */
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
  const trace = useValue(service.trace)
  const selected = useValue(service.selected)
  const failure = useValue(service.failure)
  const notFound = useValue(service.notFound)

  useEffect(() => {
    void service.open(traceId)
  }, [service, traceId])

  if (failure) return <Alert tone="bad" title="Could not load the trace">{failure}</Alert>
  if (notFound) return <Box label="Trace"><BoxEmpty icon={WaypointsIcon} title="There is no such trace" description="It was not kept, or it is older than its application's retention." /></Box>
  if (!trace) return <Skeleton lines={8} />
  const span = trace.spans.find(each => each.id === selected) ?? null

  return (
    <Stack gap={4}>
      <Subhead
        title={<Mono>{trace.name}</Mono>}
        description={(
          <>
            {trace.job ? <>Run {trace.job.run} of a job of <TextLink href={`/apps/${app.id}/queues/${trace.spans.find(each => each.context)?.context ?? ''}/${trace.job.queue}`}><Mono>{trace.job.queue}</Mono></TextLink>, for <Mono>{trace.job.event}</Mono></> : 'A request'}
            {', '}<RelativeTime date={trace.startedAt} />, in {formatMs(trace.ms)}{trace.actor ? `, by ${trace.actor}` : ''}
            {Object.entries(trace.scopes).map(([scope, value]) => `, ${scope} ${value}`).join('')}
          </>
        )}
        actions={<TraceBadge trace={trace} />}
      />
      <TraceLinks app={app} trace={trace} />
      <Box label="Steps">
        <BoxHeader>Steps <Counter>{trace.spans.length}</Counter>{trace.dropped > 0 && <> and {trace.dropped} more, not kept</>}</BoxHeader>
        <Waterfall label={`Steps of ${trace.name}`} rows={rowsOf(trace.spans)} totalMs={trace.ms} formatMs={formatMs} selected={selected} onSelect={id => service.select(id)} />
      </Box>
      {span && <SpanDetail app={app} span={span} />}
    </Stack>
  )
}

/** How it ended, at a glance. */
function TraceBadge({ trace }: { trace: TraceDTO }) {
  if (trace.outcome?.kind === 'failure') return <Badge tone="bad">Failed: {trace.outcome.code}</Badge>
  if (trace.outcome?.kind === 'error') return <Badge tone="warn">Error: {trace.outcome.code}</Badge>
  if (trace.retried) return <Badge tone="warn">Ran again</Badge>
  return <Badge tone="ok">Went well</Badge>
}

/** What it is linked to: the trace that told its job's event, its job's runs, and the jobs its events caused. */
function TraceLinks({ app, trace }: { app: AppDTO, trace: TraceDTO }) {
  const runs = trace.runs.filter(run => run.id !== trace.id)
  if (!trace.causedBy && runs.length === 0 && trace.caused.length === 0) return null
  return (
    <>
      {trace.causedBy && (
        <Box label="Caused by">
          <BoxHeader>Caused by: the trace that told its event</BoxHeader>
          <TraceRow appId={app.id} trace={trace.causedBy} />
        </Box>
      )}
      {runs.length > 0 && (
        <Box label="Other runs">
          <BoxHeader>Its job's other runs <Counter>{runs.length}</Counter></BoxHeader>
          {runs.map(run => <TraceRow key={run.id} appId={app.id} trace={run} />)}
        </Box>
      )}
      {trace.caused.length > 0 && (
        <Box label="Caused">
          <BoxHeader>Jobs its events caused <Counter>{trace.caused.length}</Counter></BoxHeader>
          {trace.caused.map(each => <TraceRow key={each.id} appId={app.id} trace={each} />)}
        </Box>
      )}
    </>
  )
}

/** The step selected, whole: what it is, how long, what it says of itself, and a failure's message and stack. */
function SpanDetail({ app, span }: { app: AppDTO, span: Span }) {
  const attributes = Object.entries(span.attributes)
  return (
    <Box label="Step">
      <BoxHeader actions={span.kind === 'use-case' && span.context ? <TextLink href={`/apps/${app.id}/use-cases/${span.context}/${span.name}`}>Its metrics</TextLink> : undefined}>
        <Mono>{span.name}</Mono>
      </BoxHeader>
      <BoxRow>
        <Text size="sm" tone="muted">
          {KIND_LABELS[span.kind]}{span.context ? ` of ${span.context}` : ''}, from {formatMs(span.startMs)} for {formatMs(span.ms)}
          {span.outcome ? `, ended in ${span.outcome.kind === 'failure' ? 'a failure' : 'an error'}: ${span.outcome.code}` : ''}
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
  'job': 'A job\'s run',
  'use-case': 'A use case',
  'attempt': 'A run of its use case',
  'query': 'A query',
  'transaction': 'A transaction',
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  query: 'Shape',
  rows: 'Rows',
  runs: 'Runs',
  commitMs: 'Commit',
  told: 'Events told',
  'validation.fields': 'Fields found wrong',
}

/** Each span a row, under the one it ran in, in order: coloured by what it is and how it ended. */
function rowsOf(spans: Span[]): WaterfallRow[] {
  const children = new Map<string | null, Span[]>()
  for (const span of spans) children.set(span.parentId, [...children.get(span.parentId) ?? [], span])
  const rows: WaterfallRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const span of (children.get(parentId) ?? []).toSorted((a, b) => a.startMs - b.startMs)) {
      rows.push({ id: span.id, depth, label: span.name, detail: detailOf(span), startMs: span.startMs, ms: span.ms, tone: toneOf(span) })
      walk(span.id, depth + 1)
    }
  }
  walk(null, 0)
  return rows
}

function detailOf(span: Span): string | undefined {
  if (span.kind === 'query') return [span.attributes.query, span.attributes.rows !== undefined ? `${span.attributes.rows} rows` : null].filter(Boolean).join(' · ') || undefined
  if (span.kind === 'transaction' && span.attributes.commitMs !== undefined) return `commit ${formatMs(Number(span.attributes.commitMs))}`
  if (span.kind === 'use-case') return [span.context, span.attributes.runs ? `ran ${span.attributes.runs} times` : null].filter(Boolean).join(' · ')
  if (span.outcome) return span.outcome.code
  return undefined
}

function toneOf(span: Span): WaterfallTone {
  if (span.outcome?.kind === 'failure') return 'bad'
  if (span.outcome?.kind === 'error') return 'warn'
  if (span.kind === 'query' || span.kind === 'transaction') return 'muted'
  if (span.kind === 'use-case' || span.kind === 'attempt') return 'brand'
  return 'ok'
}
