import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { DownloadIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
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

/** What is not released yet, publishing it, every release, and the documents to take away. */
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
  const submitting = useValue(service.form.submitting)
  const readOnly = Boolean(workspace?.archivedAt)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.publish()
  }

  return (
    <Stack gap={8}>
      <PageHeader
        title="Releases"
        description="Pictures of the definition in force, taken when the product is released."
        actions={(
          <Inline gap={2} wrap>
            <Button variant="outline" onClick={() => void service.downloadSpecification()}><Icon icon={DownloadIcon} />Specification</Button>
            <Button variant="outline" onClick={() => void service.downloadChangelog()}><Icon icon={DownloadIcon} />Changelog</Button>
          </Inline>
        )}
      />
      <Card title="Not released yet" titleLevel={2} description="What changed in the definition in force since the last release: only merged proposals count.">
        <ReleaseChanges key={version} release={null} />
      </Card>
      {!readOnly && (
        <Card title="Publish a release" titleLevel={2} description="It pictures the definition in force as it is now, and never changes.">
          <form onSubmit={onSubmit} noValidate>
            <Stack gap={4} align="start">
              <FormField form={service.form} name="name" label="Name" description="For example: v2.4.0." />
              <FormField form={service.form} name="description" label="Description" description="Optional." rows={2} />
              <Button type="submit" variant="secondary" loading={submitting}>Publish</Button>
            </Stack>
          </form>
        </Card>
      )}
      <Card title="Releases" titleLevel={2}>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not load the releases">{failure}</Alert>}
          {loaded && releases.length === 0 && <Text size="sm" tone="muted">No release yet: the first one will picture everything as new.</Text>}
          {releases.map(release => (
            <Stack key={release.id} gap={1}>
              <TextLink href={`/w/${workspaceId}/releases/${encodeURIComponent(release.name)}`}>{release.name}</TextLink>
              <Text size="sm" tone="muted">
                {`@${release.publishedBy.nick} · ${new Date(release.publishedAt).toLocaleDateString('en', { dateStyle: 'medium' })} · ${counts(release.changes)}`}
              </Text>
            </Stack>
          ))}
          {hasMore && <Inline><Button size="sm" variant="outline" loading={loadingMore} onClick={() => void service.releases.loadMore()}>Load older releases</Button></Inline>}
        </Stack>
      </Card>
    </Stack>
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
