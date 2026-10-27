import { useEffect, useState } from 'react'
import { RepeatIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Icon } from 'newt-react-ui/icon'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Mono, Text } from 'newt-react-ui/text'
import { useService } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { UseCaseMetricsApi, type UseCaseTotalDTO } from '../../../api/use-case-metrics'
import { formatMs } from '../app-metrics/metrics-format'

/** The use cases that ran again most after a conflict in the last 24 hours: where its rows are fought over. */
export function AppOverviewRetries({ app }: { app: AppDTO }) {
  const api = useService(UseCaseMetricsApi)
  const [fought, setFought] = useState<UseCaseTotalDTO[] | null>(null)

  useEffect(() => {
    api.totals(app.id, '24h')
      .then(totals => setFought(totals.filter(each => each.now.retries > 0).sort((a, b) => b.now.retries - a.now.retries).slice(0, 5)))
      .catch(() => setFought([]))
  }, [api, app.id])

  return (
    <Box label="Most run again">
      <BoxHeader><Icon icon={RepeatIcon} tone="muted" /> Most run again after a conflict, in 24 hours</BoxHeader>
      {fought === null && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {fought?.length === 0 && <BoxEmpty icon={RepeatIcon} title="No conflicts in 24 hours" description="No use case had to run again: nobody saved what another had read meanwhile." />}
      {fought?.map(each => (
        <BoxRow key={`${each.context}|${each.useCase}`} leading={<Icon icon={RepeatIcon} tone="warn" />} trailing={<Text size="sm" tone="muted">{each.now.retries.toLocaleString('en')} retries</Text>}>
          <BoxRowTitle href={`/apps/${app.id}/use-cases/${each.context}/${each.useCase}`}><Mono>{each.useCase}</Mono></BoxRowTitle>
          <BoxRowMeta>
            <>{((each.now.retries / each.now.calls) * 100).toLocaleString('en', { maximumFractionDigits: 1 })} per 100 calls</>
            <>{each.now.calls.toLocaleString('en')} calls</>
            <>p90 {formatMs(each.now.p90)}</>
            <>in {each.context}</>
          </BoxRowMeta>
        </BoxRow>
      ))}
    </Box>
  )
}
