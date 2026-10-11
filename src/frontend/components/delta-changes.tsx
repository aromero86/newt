import type { ReactNode } from 'react'
import type { DimensionDTO } from '@newt/api/dimension'
import type { FeatureDTO } from '@newt/api/feature'
import type { FeatureAreaDTO } from '@newt/api/feature-area'
import type { DeltaDimensionState, DeltaDTO, DeltaFeatureAreaState, DeltaFeatureState, DeltaRuleChangeState, DeltaRuleCreateState } from '@newt/api/proposal'
import type { RuleDTO } from '@newt/api/rule'
import { Badge } from '@newt/ui/components/badge'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@newt/ui/components/table'
import { Text } from '@newt/ui/components/text'
import { RuleScope } from './rule-scope'

type Row = { label: string, before: ReactNode, after: ReactNode }

type DeltaChangesProps = {
  delta: DeltaDTO
  /** The workspace's dimensions, to name the values a scope points at. */
  dimensions: DimensionDTO[]
  /** The name of an area or a feature, by id. */
  name: (id: string) => string
  caption: string
}

/** What a delta changes, field by field: before and after. For a change, only what differs. */
export function DeltaChanges({ delta, dimensions, name, caption }: DeltaChangesProps) {
  const rows = rowsOf(delta, dimensions, name)
  if (rows.length === 0) return null
  return (
    <Table caption={caption}>
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
