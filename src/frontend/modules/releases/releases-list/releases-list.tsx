import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { DownloadIcon, PlusIcon, TagIcon } from 'lucide-react'
import type { ReleaseDTO } from '@newt/api/release'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxEmpty, BoxHeader, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { ReleaseChanges } from '../release-changes/release-changes'
import { ReleasesListService } from './releases-list.service'

/** With its own ReleasesListService: whoever renders it needs nothing else. */
export function ReleasesList() {
  return (
    <Provide services={[ReleasesListService]}>
      <ReleasesListWrapped />
    </Provide>
  )
}

/** "3 new, 1 changed". */
export function counts(changes: { added: number, changed: number, retired: number, restored: number }): string {
  return [
    changes.added && `${changes.added} new`,
    changes.changed && `${changes.changed} changed`,
    changes.retired && `${changes.retired} retired`,
    changes.restored && `${changes.restored} restored`,
  ].filter(Boolean).join(', ')
}

/** Like a repository's releases: what is not released yet, every release newest first, and the documents. */
function ReleasesListWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(ReleasesListService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const version = useValue(service.version)
  const releases = useValue(service.releases.items)
  const loaded = useValue(service.releases.loaded)
  const failure = useValue(service.releases.failure)
  const hasMore = useValue(service.releases.hasMore)
  const loadingMore = useValue(service.releases.loadingMore)
  const readOnly = Boolean(workspace?.archivedAt)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  return (
    <Stack gap={6}>
      <Subhead
        title="Releases"
        description="Pictures of the definition in force, taken when the product is released."
        actions={(
          <>
            <Button size="sm" variant="outline" onClick={() => void service.downloadSpecification()}><Icon icon={DownloadIcon} size="sm" />Specification</Button>
            <Button size="sm" variant="outline" onClick={() => void service.downloadChangelog()}><Icon icon={DownloadIcon} size="sm" />Changelog</Button>
            {!readOnly && <Button size="sm" onClick={() => service.openPublish()}><Icon icon={PlusIcon} size="sm" />Publish a release</Button>}
          </>
        )}
      />
      <ReleaseChanges key={version} release={null} title="Not released yet" />
      {failure && <Alert tone="bad" title="Could not load the releases">{failure}</Alert>}
      {loaded && releases.length === 0 && (
        <Box label="Releases"><BoxEmpty icon={TagIcon} title="No release yet" description="The first one will picture everything as new." /></Box>
      )}
      {releases.map((release, index) => <ReleasesListItem key={release.id} release={release} latest={index === 0} />)}
      {hasMore && <Inline justify="center"><Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.releases.loadMore()}>Load older releases</Button></Inline>}
      <ReleasesListPublish />
    </Stack>
  )
}

/** One release, like GitHub's: its tag, who published it and when, and what it changed. */
function ReleasesListItem({ release, latest }: { release: ReleaseDTO, latest: boolean }) {
  const workspaceId = useParams().workspaceId!
  return (
    <Box label={release.name}>
      <BoxHeader actions={<Text size="sm" tone="muted" as="span">{`@${release.publishedBy.nick} · `}<RelativeTime date={release.publishedAt} /></Text>}>
        <Inline gap={2}>
          <Icon icon={TagIcon} size="sm" tone="muted" />
          <BoxRowTitle href={`/w/${workspaceId}/releases/${encodeURIComponent(release.name)}`}>{release.name}</BoxRowTitle>
          {latest && <Badge tone="ok">Latest</Badge>}
        </Inline>
      </BoxHeader>
      <BoxBody>
        <Stack gap={2}>
          {release.description && <Text size="sm">{release.description}</Text>}
          <Text size="sm" tone="muted">{counts(release.changes)}</Text>
        </Stack>
      </BoxBody>
    </Box>
  )
}

/** Publishing a release: its name and, if wanted, a description. */
function ReleasesListPublish() {
  const service = useService(ReleasesListService)
  const open = useValue(service.publishing)
  const submitting = useValue(service.form.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.publish()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closePublish()} title="Publish a release" description="It pictures the definition in force as it is now, and never changes." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="name" label="Name" description="For example: v2.4.0." />
          <FormField form={service.form} name="description" label="Description" description="Optional." rows={3} />
          <Inline justify="end"><Button type="submit" loading={submitting}>Publish</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
