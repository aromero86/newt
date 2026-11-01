import { useEffect } from 'react'
import type { DayCountDTO } from '@cooper/api/backoffice-metric'
import { Alert } from '@newt-kit/react-ui/alert'
import { BarChart } from '@newt-kit/react-ui/bar-chart'
import { Card } from '@newt-kit/react-ui/card'
import { Grid } from '@newt-kit/react-ui/grid'
import { PageHeader } from '@newt-kit/react-ui/page-header'
import { Skeleton } from '@newt-kit/react-ui/skeleton'
import { Stack } from '@newt-kit/react-ui/stack'
import { Stat } from '@newt-kit/react-ui/stat'
import { Provide, useService, useValue } from '@newt-kit/react'
import { OverviewRecentBoards } from './overview-recent-boards'
import { OverviewService } from './overview.service'

/** A day as the chart labels it: `Oct 26`. */
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const series = (days: DayCountDTO[]) => days.map(each => ({ label: dayLabel(each.day), value: each.count }))
const plural = (word: string) => (value: number) => `${value.toLocaleString('en')} ${word}${value === 1 ? '' : 's'}`

/** Where the console opens: cooper's numbers. With its own OverviewService. */
export function Overview() {
  return (
    <Provide services={[OverviewService]}>
      <OverviewWrapped />
    </Provide>
  )
}

function OverviewWrapped() {
  const overview = useService(OverviewService)
  const metrics = useValue(overview.metrics)
  const failure = useValue(overview.failure)

  useEffect(() => {
    void overview.load()
  }, [overview])

  return (
    <Stack gap={6}>
      <PageHeader title="Overview" description="Cooper's numbers, counted from what happens in it: a moment behind." />
      {failure && <Alert tone="bad" title="Could not load the numbers">{failure}</Alert>}
      {!metrics && !failure && <Skeleton height="lg" />}
      {metrics && (
        <>
          <Grid columns={{ base: 1, sm: 3 }}>
            {/* Counts of what happened, so things deleted since still count: not how many there are now. */}
            <Stat label="Cards created" value={metrics.totals.cards} hint="Since counting began, deleted ones too" />
            <Stat label="Workspaces created" value={metrics.totals.workspaces} hint="Since counting began, deleted ones too" />
            <Stat label="Sign ups" value={metrics.totals.signUps} hint="Since counting began" />
          </Grid>
          <Card title="Cards created per day" titleLevel={2} description={`The last ${metrics.cardsPerDay.length} days`}>
            <BarChart label="Cards created per day" data={series(metrics.cardsPerDay)} formatValue={plural('card')} />
          </Card>
          <Grid columns={{ base: 1, md: 2 }}>
            <Card title="New workspaces per day" titleLevel={2}>
              <BarChart label="New workspaces per day" data={series(metrics.workspacesPerDay)} formatValue={plural('workspace')} />
            </Card>
            <Card title="Sign ups per day" titleLevel={2}>
              <BarChart label="Sign ups per day" data={series(metrics.signUpsPerDay)} formatValue={plural('sign up')} />
            </Card>
          </Grid>
          <OverviewRecentBoards />
        </>
      )}
    </Stack>
  )
}
