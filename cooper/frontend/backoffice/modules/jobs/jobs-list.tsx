import { useState } from 'react'
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react'
import type { ContextJobDTO, JobContext } from '@cooper/api/backoffice-job'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxEmpty, BoxFooter, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Mono, Text } from 'newt-react-ui/text'
import { toast } from 'newt-react-ui/toast'
import { useService, useValue } from 'newt-react'
import { JobsService } from './jobs.service'

/** The first line of an error: its message, without the stack under it. */
const firstLine = (error: string | null) => error?.split('\n')[0] ?? 'No error was kept'

/** A context's dead jobs, each with why it died and a button to run it again. */
export function JobsList({ context }: { context: JobContext }) {
  const jobs = useService(JobsService)
  const list = jobs.lists[context]
  const items = useValue(list.items)
  const loaded = useValue(list.loaded)
  const hasMore = useValue(list.hasMore)
  const loadingMore = useValue(list.loadingMore)
  const failure = useValue(list.failure)
  // The job being put back, while its request is on its way.
  const [retrying, setRetrying] = useState<string | null>(null)

  async function retry(job: ContextJobDTO) {
    setRetrying(job.id)
    const problem = await jobs.retry(job)
    setRetrying(null)
    if (problem) toast.error(problem)
    else toast.success(`${job.queue} runs again`)
  }

  return (
    <Box label={`Dead jobs of ${context}`}>
      {failure && <BoxRow><Alert tone="bad" title="Could not load the jobs">{failure}</Alert></BoxRow>}
      {!loaded && !failure && <BoxRow><Skeleton lines={2} /></BoxRow>}
      {loaded && items.length === 0 && <BoxEmpty icon={CircleCheckIcon} title="No dead jobs" description="Every reaction of this context ran, or is on its way." />}
      {items.map(job => (
        <BoxRow
          key={job.id}
          trailing={(
            <Button size="sm" variant="outline" loading={retrying === job.id} onClick={() => void retry(job)}>
              <Icon icon={RotateCcwIcon} size="sm" />Retry
            </Button>
          )}
        >
          <BoxRowTitle><Mono>{job.queue}</Mono></BoxRowTitle>
          <BoxRowMeta>
            <>{job.event}</>
            <>{job.attempts} {job.attempts === 1 ? 'attempt' : 'attempts'}</>
            <>died <RelativeTime date={job.updatedAt} /></>
          </BoxRowMeta>
          <Text size="sm" tone="destructive">{firstLine(job.lastError)}</Text>
        </BoxRow>
      ))}
      {hasMore && (
        <BoxFooter>
          <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void list.loadMore()}>Load more</Button>
        </BoxFooter>
      )}
    </Box>
  )
}
