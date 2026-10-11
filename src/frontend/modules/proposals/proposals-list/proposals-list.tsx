import { useEffect, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { GitPullRequestIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { EmptyState } from '@newt/ui/components/empty-state'
import { Field } from '@newt/ui/components/field'
import { Inline } from '@newt/ui/components/inline'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Select } from '@newt/ui/components/select'
import { Spinner } from '@newt/ui/components/spinner'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ProposalBadge } from '@newt/ui/domain/proposal-badge'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { PROPOSAL_VIEWS, ProposalsListService, type ProposalView } from './proposals-list.service'

/** With its own ProposalsListService: whoever renders it needs nothing else. */
export function ProposalsList() {
  return (
    <Provide services={[ProposalsListService]}>
      <ProposalsListWrapped />
    </Provide>
  )
}

/** The workspace's proposals, by state, and a new one. */
function ProposalsListWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(ProposalsListService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const view = useValue(service.view)
  const proposals = useValue(service.proposals.items)
  const total = useValue(service.proposals.total)
  const loaded = useValue(service.proposals.loaded)
  const failure = useValue(service.proposals.failure)
  const hasMore = useValue(service.proposals.hasMore)
  const loadingMore = useValue(service.proposals.loadingMore)
  const submitting = useValue(service.form.submitting)
  const navigate = useNavigate()
  const readOnly = Boolean(workspace?.archivedAt)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const created = await service.create()
    if (created) navigate(`/w/${workspaceId}/proposals/${created.key}`)
  }

  return (
    <Stack gap={8}>
      <PageHeader title="Proposals" description="Every change to the definition, approved delta by delta." />
      <Card title={`${PROPOSAL_VIEWS[view].label} (${total})`} titleLevel={2}>
        <Stack gap={6}>
          <Inline gap={4} wrap>
            <Field label="Show">
              <Select
                value={view}
                onValueChange={next => void service.show(next as ProposalView)}
                options={Object.entries(PROPOSAL_VIEWS).map(([value, { label }]) => ({ value, label }))}
              />
            </Field>
          </Inline>
          {failure && <Alert tone="bad" title="Could not load the proposals">{failure}</Alert>}
          {!loaded && !failure && <Spinner label="Loading the proposals" />}
          {loaded && proposals.length === 0 && (
            <EmptyState icon={GitPullRequestIcon} title="No proposals here" description="A proposal gathers the changes to the definition, to approve one by one." />
          )}
          {proposals.map(proposal => (
            <Stack key={proposal.id} gap={1}>
              <Inline gap={2} wrap>
                <Text size="sm" tone="muted">{proposal.key}</Text>
                <TextLink href={`/w/${workspaceId}/proposals/${proposal.key}`}>{proposal.title}</TextLink>
                <ProposalBadge state={proposal.status} />
              </Inline>
              <Text size="sm" tone="muted">
                {`${proposal.deltas.total} ${proposal.deltas.total === 1 ? 'delta' : 'deltas'} · ${proposal.deltas.approved} approved · ${proposal.deltas.rejected} rejected · by @${proposal.createdBy.nick}${proposal.quick ? ' · quick' : ''}`}
              </Text>
            </Stack>
          ))}
          {hasMore && (
            <Inline>
              <Button variant="outline" size="sm" loading={loadingMore} onClick={() => void service.proposals.loadMore()}>
                Load more proposals
              </Button>
            </Inline>
          )}
        </Stack>
      </Card>
      {!readOnly && (
        <Card title="New proposal" titleLevel={2} description="Start a draft, then add its deltas.">
          <form onSubmit={event => void onSubmit(event)} noValidate>
            <Stack gap={4} align="start">
              <FormField form={service.form} name="title" label="Title" description="For example: Guests can pay with Bizum." />
              <Button type="submit" variant="secondary" loading={submitting}>Create draft</Button>
            </Stack>
          </form>
        </Card>
      )}
    </Stack>
  )
}
