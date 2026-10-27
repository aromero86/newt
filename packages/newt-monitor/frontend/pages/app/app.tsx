import { useEffect } from 'react'
import { Route, Routes, useParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { PageBody } from 'newt-react-ui/page-body'
import { Spinner } from 'newt-react-ui/spinner'
import { Provide, useService, useValue } from 'newt-react'
import { NotFound } from '../not-found/not-found'
import { AppBand } from './app-band/app-band'
import { AppContexts } from './app-contexts/app-contexts'
import { AppEvent } from './app-event/app-event'
import { AppEvents } from './app-events/app-events'
import { AppOverview } from './app-overview/app-overview'
import { AppSettings } from './app-settings/app-settings'
import { AppUseCases } from './app-use-cases/app-use-cases'
import { AppVersions } from './app-versions/app-versions'
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
          <Route path="use-cases" element={<AppUseCases app={app} />} />
          <Route path="events" element={<AppEvents app={app} />} />
          <Route path="events/:context/:event" element={<AppEvent app={app} />} />
          <Route path="versions/*" element={<AppVersions app={app} />} />
          <Route path="settings" element={<AppSettings app={app} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageBody>
    </>
  )
}
