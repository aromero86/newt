import { useEffect, useState } from 'react'
import { TimerIcon } from 'lucide-react'
import { Box, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Icon } from 'newt-react-ui/icon'
import { Stack } from 'newt-react-ui/stack'
import { Mono, Text } from 'newt-react-ui/text'
import { useService } from 'newt-react'
import type { MetricsWindow } from '../../../api/event-metrics'
import { TracesApi, type TraceSummaryDTO } from '../../../api/traces'
import type { LatencyDTO } from '../../../api/use-case-metrics'
import { formatMs, WINDOW_LABELS } from '../app-metrics/metrics-format'
import { TraceList } from '../app-traces/trace-list'

const PERCENTILES = ['p50', 'p90', 'p99'] as const

/**
 * A use case's traces: a call that took about each percentile's time, to see why it
 * took that; and every trace kept of it, by how it went.
 */
export function AppUseCaseTraces({ appId, context, useCase, window, total }: { appId: string, context: string, useCase: string, window: MetricsWindow, total: LatencyDTO | null }) {
  const api = useService(TracesApi)
  const [examples, setExamples] = useState<Partial<Record<typeof PERCENTILES[number], TraceSummaryDTO | null>>>({})
  const targets = PERCENTILES.map(percentile => [percentile, total?.[percentile] ?? null] as const)
  const key = JSON.stringify(targets)

  useEffect(() => {
    setExamples({})
    for (const [percentile, ms] of JSON.parse(key) as typeof targets) {
      if (ms === null) continue
      api.list(appId, { context, useCase, window, nearMs: ms, limit: 1 })
        .then(page => setExamples(current => ({ ...current, [percentile]: page.traces[0] ?? null })))
        .catch(() => setExamples(current => ({ ...current, [percentile]: null })))
    }
  }, [api, appId, context, useCase, window, key])

  return (
    <Stack gap={4}>
      <Box label="Examples">
        <BoxHeader><Icon icon={TimerIcon} tone="muted" /> A call that took about each percentile, in {WINDOW_LABELS[window]}</BoxHeader>
        {targets.map(([percentile, ms]) => {
          const example = examples[percentile]
          return (
            <BoxRow key={percentile} leading={<Text size="sm" weight="semibold" as="span">{percentile}</Text>} trailing={<Text size="sm" tone="muted" as="span">{formatMs(ms)}</Text>}>
              {example
                ? <BoxRowTitle href={`/apps/${appId}/traces/${example.id}`}><Mono>{example.name}</Mono></BoxRowTitle>
                : <Text size="sm" tone="muted">{ms === null || example === null ? 'No trace kept near it' : 'Looking for one…'}</Text>}
              {example && <BoxRowMeta><>its call took {formatMs(example.callMs)}</><>the whole {formatMs(example.ms)}</></BoxRowMeta>}
            </BoxRow>
          )
        })}
      </Box>
      <TraceList appId={appId} title="Traces" query={{ context, useCase }} window={window} />
    </Stack>
  )
}
