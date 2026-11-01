import { UserIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from '@newt-kit/react-ui/box'
import { Button } from '@newt-kit/react-ui/button'
import { Grid } from '@newt-kit/react-ui/grid'
import { Inline } from '@newt-kit/react-ui/inline'
import { Select } from '@newt-kit/react-ui/select'
import { Mono, Text } from '@newt-kit/react-ui/text'
import { useService, useValue } from '@newt-kit/react'
import type { ErrorsTopDTO } from '../../../api/use-case-errors'
import type { UseCaseTopDTO } from '../../../api/use-case-metrics'
import { formatMs } from '../app-metrics/metrics-format'
import { AppUseCaseService, type TopOrder } from './app-use-case.service'

const TITLES: Record<TopOrder, string> = {
  calls: 'Who calls it most',
  retries: 'Who makes it run again most',
  errors: 'Who ends it in errors most',
  failures: 'Who ends it in failures most',
}

/** Who calls a use case, by actor and by each of its scopes: ordered by calls, retries, errors or failures, one click to filter by them. */
export function AppUseCaseTops() {
  const service = useService(AppUseCaseService)
  const order = useValue(service.order)
  const tops = useValue(service.tops)

  return (
    <>
      <Inline gap={2} justify="end">
        <Select
          size="compact"
          label="Order who"
          value={order}
          onValueChange={value => void service.orderBy(value as TopOrder)}
          options={(Object.keys(TITLES) as TopOrder[]).map(each => ({ value: each, label: TITLES[each] }))}
        />
      </Inline>
      <Grid columns={{ base: 1, md: 2 }}>
        {tops.map(({ by, top }) => (
          <Box key={by} label={by === 'actor' ? 'By actor' : `By ${by.slice(6)}`}>
            <BoxHeader>{by === 'actor' ? TITLES[order] : <>By {by.slice(6)}</>}</BoxHeader>
            {top.length === 0 && <BoxEmpty icon={UserIcon} title="Nobody in this window" />}
            {top.map(row => (
              <BoxRow key={row.value ?? 'none'} trailing={<Text size="sm" tone="muted">{headline(order, row)}</Text>}>
                {row.value === null
                  ? <Text size="sm" tone="muted">{by === 'actor' ? 'No one (a worker, a schedule)' : 'Outside any'}</Text>
                  : <Button size="sm" variant="link" onClick={() => void service.filter(by === 'actor' ? { actor: row.value } : { scope: `${by.slice(6)}:${row.value}` })}><Mono>{row.value}</Mono></Button>}
                {'calls' in row
                  ? (
                      <BoxRowMeta>
                        {order === 'retries' ? <>{row.calls.toLocaleString('en')} calls</> : row.retries > 0 && <>{row.retries.toLocaleString('en')} retries</>}
                        <>p50 {formatMs(row.p50)}</>
                        <>p90 {formatMs(row.p90)}</>
                        <>p99 {formatMs(row.p99)}</>
                      </BoxRowMeta>
                    )
                  : (
                      <BoxRowMeta>
                        <>{row.errors.toLocaleString('en')} errors</>
                        <>{row.failures.toLocaleString('en')} failures</>
                      </BoxRowMeta>
                    )}
              </BoxRow>
            ))}
          </Box>
        ))}
      </Grid>
    </>
  )
}

/** What a row is ordered by, said at its end. */
function headline(order: TopOrder, row: UseCaseTopDTO | ErrorsTopDTO): string {
  if ('calls' in row) return order === 'retries' ? `${row.retries.toLocaleString('en')} retries` : `${row.calls.toLocaleString('en')} calls`
  return order === 'errors' ? `${row.errors.toLocaleString('en')} errors` : `${row.failures.toLocaleString('en')} failures`
}
