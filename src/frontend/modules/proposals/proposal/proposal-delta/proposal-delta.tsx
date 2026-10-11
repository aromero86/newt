import { useState } from 'react'
import { MessageSquareIcon } from 'lucide-react'
import type { DeltaDTO, ProposalDTO } from '@newt/api/proposal'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Box, BoxBody, BoxFooter, BoxHeader } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { DeltaChanges, DeltaStateChanges } from '../../../../components/delta-changes'
import { DeltaTitle, KIND_LABEL, OPERATION_LABEL } from '../../../../components/delta-title'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { SessionService } from '../../../../services/session/session.service'
import { ProposalDiscussions } from '../proposal-discussions/proposal-discussions'
import { ProposalService } from '../proposal.service'

/**
 * One delta as the last revision published it, like a file in a pull request: what
 * it changes, what changed since it was approved, the verdicts and its conversations.
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
    <Box label={caption}>
      <BoxHeader
        actions={(
          <>
            {changedLater && lastChange.change === 'added' && <Badge tone="info">{`new in r${lastChange.revision}`}</Badge>}
            {changedLater && lastChange.change === 'changed' && (
              <Button size="sm" variant="ghost" onClick={() => setShowChange(!showChange)}>{showChange ? 'Hide what changed' : `Changed in r${lastChange.revision}`}</Button>
            )}
            <DeltaBadge state={delta.status} />
            {reviewing && mine?.verdict !== 'approved' && <Button size="sm" variant="secondary" onClick={() => void service.approve(delta)}>Approve</Button>}
            {reviewing && mine?.verdict !== 'rejected' && <Button size="sm" variant="ghost" onClick={() => service.openReject(delta)}>Reject</Button>}
            {reviewing && mine && <Button size="sm" variant="ghost" onClick={() => void service.withdraw(delta)}>Withdraw</Button>}
          </>
        )}
      >
        <DeltaTitle delta={delta} />
      </BoxHeader>
      <BoxBody flush>
        <DeltaChanges delta={delta} dimensions={dimensions} name={id => service.name(id)} caption={caption} flush />
      </BoxBody>
      {changedLater && lastChange.change === 'changed' && showChange && lastChange.previous && (
        <BoxBody>
          <Stack gap={2}>
            <Text size="sm" weight="medium">{`What changed in revision ${lastChange.revision}, since it was last approved`}</Text>
            <DeltaStateChanges
              kind={delta.kind}
              from={lastChange.previous.after}
              to={delta.after}
              dimensions={dimensions}
              name={id => service.name(id)}
              caption={`What changed in ${caption} in revision ${lastChange.revision}`}
            />
          </Stack>
        </BoxBody>
      )}
      {delta.blockers.length > 0 && (
        <BoxBody>
          <Stack gap={2}>{delta.blockers.map(blocker => <Alert key={blocker} tone="warn" title="Blocked">{blocker}</Alert>)}</Stack>
        </BoxBody>
      )}
      <BoxFooter justify="between">
        <Inline gap={3} wrap>
            {delta.reviews.length === 0 && <Text size="sm" tone="muted" as="span">No verdicts yet</Text>}
            {delta.reviews.map(review => (
              <Text key={review.userId} size="sm" tone={review.verdict === 'rejected' ? 'destructive' : 'muted'} as="span">
                {`@${review.nick} ${review.verdict}${review.reason ? `: ${review.reason}` : ''}`}
              </Text>
            ))}
        </Inline>
        <Button size="sm" variant="ghost" onClick={() => setShowDiscussions(!showDiscussions)}>
          <Icon icon={MessageSquareIcon} size="sm" />
          {`${counts?.discussions ?? 0}${counts?.open ? ` · ${counts.open} open` : ''}`}
        </Button>
      </BoxFooter>
      {showDiscussions && <BoxBody><ProposalDiscussions deltaId={delta.id} readOnly={readOnly} /></BoxBody>}
    </Box>
  )
}
