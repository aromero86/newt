import { useEffect } from 'react'
import { useParams } from 'react-router'
import { DownloadIcon } from 'lucide-react'
import { Box, BoxBody, BoxHeader } from '@newt/ui/components/box'
import { Breadcrumbs } from '@newt/ui/components/breadcrumbs'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Markdown } from '@newt/ui/components/markdown'
import { PageTitle } from '@newt/ui/components/page-title'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import { Text } from '@newt/ui/components/text'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { NotFound } from '../../../pages/not-found/not-found'
import { ReleaseChanges } from '../release-changes/release-changes'
import { counts } from '../releases-list/releases-list'
import { ReleaseService } from './release.service'

/** With its own ReleaseService: whoever renders it needs nothing else. */
export function Release() {
  return (
    <Provide services={[ReleaseService]}>
      <ReleaseWrapped />
    </Provide>
  )
}

/** One release: what it changed since the one before, and the definition as it left it. */
function ReleaseWrapped() {
  const { workspaceId, name } = useParams() as { workspaceId: string, name: string }
  const service = useService(ReleaseService)
  const release = useValue(service.release)
  const specification = useValue(service.specification)

  useEffect(() => {
    void service.load(workspaceId, name)
  }, [service, workspaceId, name])

  if (release === undefined) return <Spinner label="Loading the release" />
  if (release === null) return <NotFound />

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Breadcrumbs items={[{ label: 'Releases', href: `/w/${workspaceId}/releases` }, { label: release.name }]} />
        <Inline justify="between" gap={3} wrap>
          <PageTitle>{release.name}</PageTitle>
          <Inline gap={2} wrap>
            <Button size="sm" variant="outline" onClick={() => service.downloadSpecification()}><Icon icon={DownloadIcon} size="sm" />Specification</Button>
            <Button size="sm" variant="outline" onClick={() => void service.downloadChangelog()}><Icon icon={DownloadIcon} size="sm" />Changelog since</Button>
          </Inline>
        </Inline>
        <Text size="sm" tone="muted">
          {`@${release.publishedBy.nick} published it `}<RelativeTime date={release.publishedAt} />{` · ${counts(release.changes)}`}
        </Text>
        {release.description && <Text>{release.description}</Text>}
      </Stack>
      <Tabs defaultValue="changes" variant="underline">
        <TabsList label="Release">
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>
        <TabsContent value="changes"><ReleaseChanges release={release.name} title="Changed in this release" /></TabsContent>
        <TabsContent value="definition">
          <Box label="The definition as this release left it">
            <BoxHeader>The definition as this release left it</BoxHeader>
            <BoxBody>{specification ? <Markdown>{specification.markdown}</Markdown> : <Spinner label="Loading the definition" />}</BoxBody>
          </Box>
        </TabsContent>
      </Tabs>
    </Stack>
  )
}
