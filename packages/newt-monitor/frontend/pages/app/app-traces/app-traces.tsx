import { useState } from 'react'
import { Button } from 'newt-react-ui/button'
import { Inline } from 'newt-react-ui/inline'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import type { AppDTO } from '../../../api/app'
import { WINDOWS, type MetricsWindow } from '../../../api/event-metrics'
import { WINDOW_LABELS } from '../app-metrics/metrics-format'
import { TraceList } from './trace-list'

/** The Traces tab: every request and job kept, of any use case or queue. */
export function AppTraces({ app }: { app: AppDTO }) {
  const [window, setWindow] = useState<MetricsWindow>('24h')

  return (
    <Stack gap={4}>
      <Subhead title="Traces" description="Each request and job that failed, ended in an error or ran again, and a share of the rest: its use cases, their runs and their queries." />
      <Inline gap={2} wrap>
        {(Object.keys(WINDOWS) as MetricsWindow[]).map(each => (
          <Button key={each} size="sm" variant={each === window ? 'secondary' : 'ghost'} onClick={() => setWindow(each)}>{WINDOW_LABELS[each]}</Button>
        ))}
      </Inline>
      <TraceList appId={app.id} title="Kept" query={{}} window={window} />
    </Stack>
  )
}
