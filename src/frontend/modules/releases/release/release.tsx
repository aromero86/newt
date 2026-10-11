import { useEffect } from 'react'
import { useParams } from 'react-router'
import { DownloadIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { Markdown } from '@newt/ui/components/markdown'
import { PageHeader } from '@newt/ui/components/page-header'
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
    <Stack gap={8}>
      <Stack gap={2}>
        <TextLink href={`/w/${workspaceId}/releases`}>All releases</TextLink>
        <PageHeader
          title={release.name}
          description={`Published by @${release.publishedBy.nick} on ${new Date(release.publishedAt).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })} · ${counts(release.changes)}`}
          actions={(
            <Inline gap={2} wrap>
              <Button variant="outline" onClick={() => service.downloadSpecification()}><Icon icon={DownloadIcon} />Specification</Button>
              <Button variant="outline" onClick={() => void service.downloadChangelog()}><Icon icon={DownloadIcon} />Changelog since</Button>
            </Inline>
          )}
        />
        {release.description && <Text>{release.description}</Text>}
      </Stack>
      <Tabs defaultValue="changes">
        <TabsList label="Release">
          <TabsTrigger value="changes">Changes</TabsTrigger>
          <TabsTrigger value="definition">Definition</TabsTrigger>
        </TabsList>
        <TabsContent value="changes"><ReleaseChanges release={release.name} /></TabsContent>
        <TabsContent value="definition">
          <Card title="The definition as this release left it" titleLevel={2}>
            {specification ? <Markdown>{specification.markdown}</Markdown> : <Spinner label="Loading the definition" />}
          </Card>
        </TabsContent>
      </Tabs>
    </Stack>
  )
}
