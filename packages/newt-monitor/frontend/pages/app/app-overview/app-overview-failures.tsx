import { useEffect, useState } from 'react'
import { CircleXIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt-kit/react-ui/box'
import { Icon } from '@newt-kit/react-ui/icon'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Mono, Text } from '@newt-kit/react-ui/text'
import { useService } from '@newt-kit/react'
import type { AppDTO } from '../../../api/app'
import { UseCaseErrorsApi, type ErrorsTotalDTO } from '../../../api/use-case-errors'
import { changeOf } from '../app-metrics/metrics-format'

/** The use cases whose calls failed most in the last 24 hours, in ways nobody expected: what to look at first. */
export function AppOverviewFailures({ app }: { app: AppDTO }) {
  const api = useService(UseCaseErrorsApi)
  const [failing, setFailing] = useState<ErrorsTotalDTO[] | null>(null)

  useEffect(() => {
    api.totals(app.id, '24h')
      .then(totals => setFailing(totals.filter(each => each.now.failures > 0).slice(0, 5)))
      .catch(() => setFailing([]))
  }, [api, app.id])

  return (
    <Box label="Most failures">
      <BoxHeader><Icon icon={CircleXIcon} tone="muted" /> Most failures nobody expected, in 24 hours</BoxHeader>
      {failing === null && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {failing?.length === 0 && <BoxEmpty icon={CircleXIcon} title="No failures in 24 hours" description="Every call that ended badly ended in an error it says may happen." />}
      {failing?.map(each => {
        const change = changeOf(each.now.failures, each.previous.failures)
        return (
          <BoxRow key={`${each.context}|${each.useCase}`} leading={<Icon icon={CircleXIcon} tone="bad" />} trailing={<Text size="sm" tone="muted">{each.now.failures.toLocaleString('en')} failures</Text>}>
            <BoxRowTitle href={`/apps/${app.id}/use-cases/${each.context}/${each.useCase}`}><Mono>{each.useCase}</Mono></BoxRowTitle>
            <BoxRowMeta>
              <>{each.previous.failures.toLocaleString('en')} the day before{change ? ` (${change})` : ''}</>
              {each.now.errors > 0 && <>{each.now.errors.toLocaleString('en')} errors</>}
              <>in {each.context}</>
            </BoxRowMeta>
          </BoxRow>
        )
      })}
    </Box>
  )
}
