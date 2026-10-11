import { useState } from 'react'
import type { DeltaDTO, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { DeltaChanges, DeltaStateChanges } from '../../../../components/delta-changes'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { SessionService } from '../../../../services/session/session.service'
import { ProposalDiscussions } from '../proposal-discussions/proposal-discussions'
import { ProposalService } from '../proposal.service'

export const KIND_LABEL = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' } as const
export const OPERATION_LABEL = { create: 'Create', change: 'Change', retire: 'Retire', restore: 'Restore' } as const

/**
 * One delta as the last revision published it: what it changes, what changed since
 * it was approved, its verdicts and its conversations.
 */
export function ProposalDelta({ delta, proposal, readOnly }: { delta: DeltaDTO, proposal: ProposalDTO, readOnly: boolean }) {
  const service = useService(ProposalService)
  const dimensions = useValue(service.dimensions)
  const counts = useValue(service.discussionCounts)[delta.id]
  useValue(service.names)
  const me = useValue(useService(SessionService).user)
  const [showChange, setShowChange] = useState(false)
  const [showDiscussions, setShowDiscussions] = useState(false)
  const mine = delta.reviews.find(review => review.userId === me?.id)
  const reviewing = proposal.status === 'in review' && !readOnly
  const caption = `${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]} ${delta.targetLabel}`
  const { lastChange } = delta
  const changedLater = lastChange && lastChange.revision > 1

  return (
    <Card
      title={(
        <Inline gap={2} wrap>
          <Text weight="semibold">{`${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]}`}</Text>
          {delta.kind === 'rule' ? <ArtifactTag kind="rule" id={delta.targetLabel} /> : <Text tone="muted">{delta.targetLabel}</Text>}
        </Inline>
      )}
      titleLevel={3}
      action={<DeltaBadge state={delta.status} />}
    >
      <Stack gap={4}>
        <DeltaChanges delta={delta} dimensions={dimensions} name={id => service.name(id)} caption={caption} />
        {changedLater && (
          <Stack gap={2}>
            <Inline gap={2} wrap>
              <Badge tone="info">{lastChange.change === 'added' ? `new in revision ${lastChange.revision}` : `changed in revision ${lastChange.revision}`}</Badge>
              {lastChange.change === 'changed' && (
                <Button size="sm" variant="ghost" onClick={() => setShowChange(!showChange)}>{showChange ? 'Hide what changed' : 'What changed'}</Button>
              )}
            </Inline>
            {showChange && lastChange.previous && (
              <DeltaStateChanges
                kind={delta.kind}
                from={lastChange.previous.after}
                to={delta.after}
                dimensions={dimensions}
                name={id => service.name(id)}
                caption={`What changed in ${caption} in revision ${lastChange.revision}`}
              />
            )}
          </Stack>
        )}
        {delta.blockers.map(blocker => <Alert key={blocker} tone="warn" title="Blocked">{blocker}</Alert>)}
        {delta.reviews.length > 0 && (
          <Stack gap={1}>
            {delta.reviews.map(review => (
              <Text key={review.userId} size="sm" tone={review.verdict === 'rejected' ? 'destructive' : 'muted'}>
                {`@${review.nick} ${review.verdict}${review.reason ? `: ${review.reason}` : ''}`}
              </Text>
            ))}
          </Stack>
        )}
        <Inline gap={2} wrap>
          {reviewing && mine?.verdict !== 'approved' && <Button size="sm" variant="secondary" onClick={() => void service.approve(delta)}>Approve</Button>}
          {reviewing && <Button size="sm" variant="outline" onClick={() => service.openReject(delta)}>Reject</Button>}
          {reviewing && mine && <Button size="sm" variant="ghost" onClick={() => void service.withdraw(delta)}>Withdraw my verdict</Button>}
          <Button size="sm" variant="ghost" onClick={() => setShowDiscussions(!showDiscussions)}>
            {`${showDiscussions ? 'Hide conversations' : 'Conversations'} (${counts?.discussions ?? 0}${counts?.open ? `, ${counts.open} open` : ''})`}
          </Button>
        </Inline>
        {showDiscussions && <ProposalDiscussions deltaId={delta.id} readOnly={readOnly} />}
      </Stack>
    </Card>
  )
}
