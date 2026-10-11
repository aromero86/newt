import type { ReactNode } from 'react'
import type { DimensionDTO } from '@newt/api/dimension'
import type { FeatureDTO } from '@newt/api/feature'
import type { FeatureAreaDTO } from '@newt/api/feature-area'
import type {
  DeltaDimensionState,
  DeltaDTO,
  DeltaFeatureAreaState,
  DeltaFeatureState,
  DeltaRuleChangeState,
  DeltaRuleCreateState,
  ProposalDTO,
} from '@newt/api/proposal'
import type { RuleDTO } from '@newt/api/rule'
import { Alert } from '@newt/ui/components/alert'
import { Badge } from '@newt/ui/components/badge'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'
import { DeltaBadge } from '@newt/ui/domain/delta-badge'
import { RuleScope } from '../../../../components/rule-scope'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { SessionService } from '../../../../services/session/session.service'
import { ProposalService } from '../proposal.service'

type Row = { label: string, before: ReactNode, after: ReactNode }

const KIND_LABEL = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' } as const
const OPERATION_LABEL = { create: 'Create', change: 'Change', retire: 'Retire', restore: 'Restore' } as const

/** One delta: what it changes, before and after, its verdicts and what can be done with it. */
export function ProposalDelta({ delta, proposal, readOnly }: { delta: DeltaDTO, proposal: ProposalDTO, readOnly: boolean }) {
  const service = useService(ProposalService)
  const dimensions = useValue(service.dimensions)
  useValue(service.names)
  const me = useValue(useService(SessionService).user)
  const mine = delta.reviews.find(review => review.userId === me?.id)
  const reviewing = proposal.status === 'in review' && !readOnly
  const editable = (proposal.status === 'draft' || proposal.status === 'in review') && !readOnly
  const rows = rowsOf(delta, dimensions, id => service.name(id))

  return (
    <Card
      title={(
        <Inline gap={2} wrap>
          <Text weight="semibold">{OPERATION_LABEL[delta.operation]} {KIND_LABEL[delta.kind]}</Text>
          {delta.kind === 'rule' ? <ArtifactTag kind="rule" id={delta.targetLabel} /> : <Text tone="muted">{delta.targetLabel}</Text>}
        </Inline>
      )}
      titleLevel={3}
      action={<DeltaBadge state={delta.status} />}
    >
      <Stack gap={4}>
        {rows.length > 0 && (
          <Table caption={`${OPERATION_LABEL[delta.operation]} ${KIND_LABEL[delta.kind]} ${delta.targetLabel}`}>
            <TableHeader>
              <TableRow>
                <TableHead>What</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  <TableCell><Text size="sm" tone="muted">{row.label}</Text></TableCell>
                  <TableCell>{row.before}</TableCell>
                  <TableCell>{row.after}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        {(reviewing || editable) && (
          <Inline gap={2} wrap>
            {reviewing && mine?.verdict !== 'approved' && <Button size="sm" variant="secondary" onClick={() => void service.approve(delta)}>Approve</Button>}
            {reviewing && <Button size="sm" variant="outline" onClick={() => service.openReject(delta)}>Reject</Button>}
            {reviewing && mine && <Button size="sm" variant="ghost" onClick={() => void service.withdraw(delta)}>Withdraw my verdict</Button>}
            {editable && <Button size="sm" variant="ghost" onClick={() => void service.remove(delta)}>Remove</Button>}
          </Inline>
        )}
      </Stack>
    </Card>
  )
}

const none = <Text size="sm" tone="muted">—</Text>
const text = (value: string | undefined) => (value ? <Text size="sm">{value}</Text> : none)
const status = (retired: boolean) => <Badge tone={retired ? 'muted' : 'ok'}>{retired ? 'retired' : 'active'}</Badge>

/** The fields a delta touches; for a change, only those that differ. */
function rowsOf(delta: DeltaDTO, dimensions: DimensionDTO[], name: (id: string) => string): Row[] {
  const changed = (rows: Row[], pairs: [unknown, unknown][]) => rows.filter((_, index) => delta.operation !== 'change' || !sameValue(pairs[index]![0], pairs[index]![1]))

  switch (delta.kind) {
    case 'feature-area': {
      const before = delta.before as FeatureAreaDTO | null
      const after = delta.after as DeltaFeatureAreaState | null
      if (!after) return [{ label: 'Status', before: status(delta.operation === 'restore'), after: status(delta.operation === 'retire') }]
      return changed([
        { label: 'Name', before: text(before?.name), after: text(after.name) },
        { label: 'Description', before: text(before?.description), after: text(after.description) },
      ], [[before?.name, after.name], [before?.description, after.description]])
    }
    case 'feature': {
      const before = delta.before as FeatureDTO | null
      const after = delta.after as DeltaFeatureState | null
      if (!after) return [{ label: 'Status', before: status(delta.operation === 'restore'), after: status(delta.operation === 'retire') }]
      return changed([
        { label: 'Area', before: text(before ? name(before.areaId) : undefined), after: text(name(after.areaId)) },
        { label: 'Name', before: text(before?.name), after: text(after.name) },
        { label: 'Description', before: text(before?.description), after: text(after.description) },
      ], [[before?.areaId, after.areaId], [before?.name, after.name], [before?.description, after.description]])
    }
    case 'rule': {
      const before = (delta.before as RuleDTO | null)?.current
      const after = delta.after as (DeltaRuleChangeState & Partial<DeltaRuleCreateState>) | null
      if (!after) return [{ label: 'Statement', before: text(before?.statement), after: <Badge tone="muted">retired</Badge> }]
      const criteria = (list: { given: string, when: string, then: string }[] | undefined) =>
        list?.length ? <Stack gap={1}>{list.map((each, index) => <Text key={index} size="sm">{`Given ${each.given}, when ${each.when}, then ${each.then}`}</Text>)}</Stack> : none
      return changed([
        ...(after.featureId ? [{ label: 'Feature', before: none, after: text(name(after.featureId)) }] : []),
        { label: 'Kind', before: text(before?.kind), after: text(after.kind) },
        { label: 'Statement', before: text(before?.statement), after: text(after.statement) },
        { label: 'Why', before: text(before?.why), after: text(after.why) },
        { label: 'Where it applies', before: before ? <RuleScope scope={before.scope} dimensions={dimensions} /> : none, after: <RuleScope scope={after.scope ?? []} dimensions={dimensions} /> },
        { label: 'Criteria', before: criteria(before?.criteria), after: criteria(after.criteria) },
      ], [
        ...(after.featureId ? [[undefined, after.featureId] as [unknown, unknown]] : []),
        [before?.kind, after.kind],
        [before?.statement, after.statement],
        [before?.why, after.why],
        [before?.scope, after.scope],
        [before?.criteria, after.criteria],
      ])
    }
    case 'dimension': {
      const before = delta.before as DimensionDTO | null
      const after = delta.after as DeltaDimensionState
      const valueRows: Row[] = after.values.flatMap(value => {
        const old = before?.values.find(candidate => candidate.id === value.id)
        if (old && old.name === value.name && (old.retiredAt !== null) === value.retired) return []
        return [{
          label: 'Value',
          before: old ? <Inline gap={2}>{text(old.name)}{old.retiredAt && status(true)}</Inline> : none,
          after: <Inline gap={2}>{text(value.name)}{value.retired && status(true)}</Inline>,
        }]
      })
      const nameRow = { label: 'Name', before: text(before?.name), after: text(after.name) }
      return [...(before?.name === after.name ? [] : [nameRow]), ...valueRows]
    }
  }
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
