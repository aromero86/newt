import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { WaypointsIcon } from 'lucide-react'
import { Box, BoxEmpty } from 'newt-kit-react-ui/box'
import { Skeleton } from 'newt-kit-react-ui/skeleton'
import { useService } from 'newt-kit-react'
import type { AppDTO } from '../../../api/app'
import { TracesApi } from '../../../api/traces'

/** A job, by its id: its last run's trace, if kept. A dead job's link leads here. */
export function AppJob({ app }: { app: AppDTO }) {
  const { jobId } = useParams() as { jobId: string }
  const api = useService(TracesApi)
  const [traceId, setTraceId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    api.list(app.id, { job: jobId, window: '365d', limit: 1 }).then(page => setTraceId(page.traces[0]?.id ?? null)).catch(() => setTraceId(null))
  }, [api, app.id, jobId])

  if (traceId === undefined) return <Skeleton lines={4} />
  if (traceId === null) return <Box label="Job"><BoxEmpty icon={WaypointsIcon} title="No trace of this job" description="Its runs were not kept, or they are older than its application's retention." /></Box>
  return <Navigate to={`/apps/${app.id}/traces/${traceId}`} replace />
}
