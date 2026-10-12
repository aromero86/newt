import { useEffect, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BanIcon, CheckCircle2Icon, GitMergeIcon, GitPullRequestIcon, PlusIcon, ZapIcon } from 'lucide-react'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxEmpty, BoxFilter, BoxFooter, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { RelativeTime } from '@newt/ui/components/relative-time'
import { Stack } from '@newt/ui/components/stack'
import { Mono } from '@newt/ui/components/text'
import { ProposalStateIcon } from '@newt/ui/domain/proposal-state-icon'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { ProposalsListService, type ProposalView } from './proposals-list.service'

const FILTERS: { view: ProposalView, label: string, icon: typeof GitPullRequestIcon }[] = [
  { view: 'open', label: 'Open', icon: GitPullRequestIcon },
  { view: 'accepted', label: 'Accepted', icon: CheckCircle2Icon },
  { view: 'merged', label: 'Merged', icon: GitMergeIcon },
  { view: 'discarded', label: 'Discarded', icon: BanIcon },
]

/** With its own ProposalsListService: whoever renders it needs nothing else. */
export function ProposalsList() {
  return (
    <Provide services={[ProposalsListService]}>
      <ProposalsListWrapped />
    </Provide>
  )
}

/** The workspace's proposals, like a repository's pull requests: by state, newest first. */
function ProposalsListWrapped() {
  const workspaceId = useParams().workspaceId!
  const service = useService(ProposalsListService)
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  const view = useValue(service.view)
  const counts = useValue(service.counts)
  const proposals = useValue(service.proposals.items)
  const loaded = useValue(service.proposals.loaded)
  const failure = useValue(service.proposals.failure)
  const hasMore = useValue(service.proposals.hasMore)
  const loadingMore = useValue(service.proposals.loadingMore)
  const readOnly = Boolean(workspace?.archivedAt)
  const base = `/w/${workspaceId}/proposals`

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  const create = readOnly ? undefined : (
    <Button size="sm" onClick={() => service.openCreate()}>
      <Icon icon={PlusIcon} size="sm" />
      New proposal
    </Button>
  )

  return (
    <Stack gap={4}>
      {failure && <Alert tone="bad" title="Could not load the proposals">{failure}</Alert>}
      <Box label="Proposals">
        <BoxHeader actions={create}>
          {FILTERS.map(filter => (
            <BoxFilter key={filter.view} active={view === filter.view} icon={filter.icon} count={counts[filter.view]} onClick={() => void service.show(filter.view)}>
              {filter.label}
            </BoxFilter>
          ))}
        </BoxHeader>
        {!loaded && !failure && <BoxEmpty title="Loading the proposals" />}
        {loaded && proposals.length === 0 && (
          <BoxEmpty
            icon={GitPullRequestIcon}
            title={view === 'open' ? 'No open proposals' : 'Nothing here'}
            description="A proposal gathers changes to the definition, to approve delta by delta. Propose one from here, or from any point of the definition."
          />
        )}
        {proposals.map(proposal => (
          <BoxRow
            key={proposal.id}
            leading={<ProposalStateIcon state={proposal.status} />}
            trailing={proposal.deltas.total > 0 && (
              <span title={`${proposal.deltas.approved} of ${proposal.deltas.total} deltas approved`}>
                <Inline gap={1}>
                  <Icon icon={CheckCircle2Icon} size="sm" tone={proposal.deltas.approved === proposal.deltas.total ? 'ok' : 'muted'} />
                  {`${proposal.deltas.approved}/${proposal.deltas.total}`}
                </Inline>
              </span>
            )}
          >
            <Inline gap={2} wrap>
              <BoxRowTitle href={`${base}/${proposal.key}`}>{proposal.title}</BoxRowTitle>
              {proposal.status === 'draft' && <Badge tone="muted">draft</Badge>}
              {proposal.quick && <Badge tone="outline"><Icon icon={ZapIcon} size="sm" />quick</Badge>}
              {proposal.extraction?.state === 'extracting' && <Badge tone="info">extracting deltas…</Badge>}
              {proposal.extraction?.state === 'failed' && <Badge tone="bad">extraction failed</Badge>}
            </Inline>
            <BoxRowMeta>
              <Mono>{proposal.key}</Mono>
              <span>{'opened '}<RelativeTime date={proposal.createdAt} />{` by @${proposal.createdBy.nick}`}</span>
              {proposal.revision > 0 && <span>{`revision ${proposal.revision}`}</span>}
              {proposal.mergedAt && <span>{'merged '}<RelativeTime date={proposal.mergedAt} /></span>}
            </BoxRowMeta>
          </BoxRow>
        ))}
        {hasMore && (
          <BoxFooter>
            <Button variant="ghost" size="sm" loading={loadingMore} onClick={() => void service.proposals.loadMore()}>Load more</Button>
          </BoxFooter>
        )}
      </Box>
      <ProposalsListCreate />
    </Stack>
  )
}

/** The dialog for a new draft: its title; deltas and document come after. */
function ProposalsListCreate() {
  const workspaceId = useParams().workspaceId!
  const service = useService(ProposalsListService)
  const open = useValue(service.creating)
  const submitting = useValue(service.form.submitting)
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const created = await service.create()
    if (created) navigate(`/w/${workspaceId}/proposals/${created.key}`)
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closeCreate()} title="New proposal" description="A draft: write its document and its deltas, then send it to review." size="md">
      <form onSubmit={event => void onSubmit(event)} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="title" label="Title" description="What it changes, for instance: Guests can pay with Bizum." />
          <Inline justify="end"><Button type="submit" loading={submitting}>Create draft</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
