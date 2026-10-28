import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { GitCommitHorizontalIcon, HistoryIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { Icon } from 'newt-react-ui/icon'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Skeleton } from 'newt-react-ui/skeleton'
import { Stack } from 'newt-react-ui/stack'
import { Mono } from 'newt-react-ui/text'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { NotFound } from '../../not-found/not-found'
import { AppVersion } from './app-version'
import { AppVersionsService } from './app-versions.service'

/** The Versions tab: each time what the application is made of changed. With its own AppVersionsService. */
export function AppVersions({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppVersionsService]}>
      <Routes>
        <Route index element={<AppVersionList app={app} />} />
        <Route path=":versionId" element={<AppVersion app={app} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Provide>
  )
}

/** Its versions, the newest first, like a repository's commits. */
function AppVersionList({ app }: { app: AppDTO }) {
  const service = useService(AppVersionsService)
  const items = useValue(service.list.items)
  const loaded = useValue(service.list.loaded)
  const loading = useValue(service.list.loading)
  const hasMore = useValue(service.list.hasMore)
  const loadingMore = useValue(service.list.loadingMore)
  const failure = useValue(service.list.failure)

  useEffect(() => {
    void service.load()
  }, [service])

  return (
    <Stack gap={4}>
      {failure && <Alert tone="bad" title="Could not load its versions">{failure}</Alert>}
      <Box label="Versions">
        <BoxHeader><Icon icon={HistoryIcon} tone="muted" /> A version each time its structure changed</BoxHeader>
        {loading && !loaded && [0, 1, 2].map(row => <BoxRow key={row}><Skeleton lines={2} /></BoxRow>)}
        {loaded && items.length === 0 && <BoxEmpty icon={HistoryIcon} title="No versions yet" description="The first one is kept the first time its structure is read." />}
        {items.map((version, index) => (
          <BoxRow
            key={version.id}
            leading={<Icon icon={GitCommitHorizontalIcon} tone="muted" />}
            trailing={index === 0 && !app.archivedAt ? <Badge tone="ok">Latest</Badge> : undefined}
          >
            <BoxRowTitle href={`/apps/${app.id}/settings/versions/${version.id}`}>Structure read <RelativeTime date={version.takenAt} /></BoxRowTitle>
            <BoxRowMeta>
              <><Mono>{version.hash.slice(0, 7)}</Mono></>
              <>{new Date(version.takenAt).toLocaleString('en')}</>
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && (
          <BoxFooter>
            <Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.list.loadMore()}>Older versions</Button>
          </BoxFooter>
        )}
      </Box>
    </Stack>
  )
}
