import { useState } from 'react'
import { CircleCheckIcon, RotateCcwIcon } from 'lucide-react'
import type { ContextJobDTO, JobContext } from '@cooper/api/backoffice-job'
import { Alert } from '@cooper/ui/components/alert'
import { Box, BoxEmpty, BoxFooter, BoxRow, BoxRowMeta, BoxRowTitle } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { Icon } from '@cooper/ui/components/icon'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Skeleton } from '@cooper/ui/components/skeleton'
import { Mono, Text } from '@cooper/ui/components/text'
import { toast } from '@cooper/ui/components/toast'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
            <span>{job.event}</span>
            <span>·</span>
            <span>{job.attempts} {job.attempts === 1 ? 'attempt' : 'attempts'}</span>
            <span>·</span>
            <span>died <RelativeTime date={job.updatedAt} /></span>
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
