import { useEffect } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { Provide, useService, useValue } from 'newt-react'
import { NotFound } from '../not-found/not-found'
import { AppBand } from './app-band/app-band'
import { AppContexts } from './app-contexts/app-contexts'
import { AppEvent } from './app-event/app-event'
import { AppJob } from './app-job/app-job'
import { AppOverview } from './app-overview/app-overview'
import { AppQueue } from './app-queue/app-queue'
import { AppQueues } from './app-queues/app-queues'
import { AppSettings } from './app-settings/app-settings'
import { AppTrace } from './app-trace/app-trace'
import { AppTraces } from './app-traces/app-traces'
import { AppUseCase } from './app-use-case/app-use-case'
import { AppService } from './app.service'

/** One application, under /apps/:appId: its band and its tabs. With its own AppService. */
export function App() {
  return (
    <Provide services={[AppService]}>
      <AppWrapped />
    </Provide>
  )
}

function AppWrapped() {
  const appId = useParams().appId!
  const service = useService(AppService)
  const app = useValue(service.app)
  const failure = useValue(service.failure)

  useEffect(() => {
    void service.load(appId)
  }, [service, appId])

  if (failure) return <PageBody><Alert tone="bad" title="Could not load the application">{failure}</Alert></PageBody>
  if (app === undefined) return <PageBody><Spinner label="Loading the application" /></PageBody>
  if (app === null) return <PageBody><NotFound /></PageBody>
  return (
    <>
      <AppBand app={app} />
      <PageBody>
        <Routes>
          <Route index element={<AppOverview app={app} />} />
          <Route path="contexts/*" element={<AppContexts app={app} />} />
          <Route path="use-cases" element={<Navigate to="../contexts" replace />} />
          <Route path="use-cases/:context/:useCase" element={<AppUseCase app={app} />} />
          <Route path="events" element={<Navigate to="../contexts" replace />} />
          <Route path="events/:context/:event" element={<AppEvent app={app} />} />
          <Route path="queues" element={<AppQueues app={app} />} />
          <Route path="queues/:context/:queue" element={<AppQueue app={app} />} />
          <Route path="traces" element={<AppTraces app={app} />} />
          <Route path="traces/:traceId" element={<AppTrace app={app} />} />
          <Route path="jobs/:jobId" element={<AppJob app={app} />} />
          <Route path="versions/*" element={<VersionsMoved />} />
          <Route path="settings/*" element={<AppSettings app={app} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageBody>
    </>
  )
}

/** Versions are in Settings now: an old address goes where it is. */
function VersionsMoved() {
  const rest = useParams()['*'] ?? ''
  return <Navigate to={`../settings/versions${rest ? `/${rest}` : ''}`} replace />
}
