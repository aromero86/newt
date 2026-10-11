import type { DimensionDTO } from '@newt/api/dimension'
import type { RuleCriterionDTO, RuleKind } from '@newt/api/rule'
import { Button } from '@newt/ui/components/button'
import { Checkbox } from '@newt/ui/components/checkbox'
import { Field } from '@newt/ui/components/field'
import { Inline } from '@newt/ui/components/inline'
import { Input } from '@newt/ui/components/input'
import { Select } from '@newt/ui/components/select'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Textarea } from '@newt/ui/components/textarea'

const RULE_KINDS: RuleKind[] = ['permission', 'validation', 'flow', 'calculation', 'legal', 'non-functional']

/** What a version of a rule says, as its fields hold it: the scope by dimension id. */
export type RuleDraftValue = {
  kind: RuleKind
  statement: string
  why: string
  scope: Record<string, string[]>
  criteria: RuleCriterionDTO[]
}

export const emptyRuleDraft: RuleDraftValue = { kind: 'validation', statement: '', why: '', scope: {}, criteria: [] }

/** The draft as the API takes it: only the dimensions with values picked. */
export function toRuleDraft(value: RuleDraftValue) {
  const { scope, ...rest } = value
  return { ...rest, scope: Object.entries(scope).filter(([, ids]) => ids.length).map(([dimensionId, valueIds]) => ({ dimensionId, valueIds })) }
}

type RuleDraftFieldsProps = {
  value: RuleDraftValue
  /** The workspace's dimensions: their active values can be picked. */
  dimensions: DimensionDTO[]
  onChange: (value: RuleDraftValue) => void
}

/** Everything a version of a rule says: kind, statement, why, where it applies and its criteria. */
export function RuleDraftFields({ value, dimensions, onChange }: RuleDraftFieldsProps) {
  const set = (change: Partial<RuleDraftValue>) => onChange({ ...value, ...change })
  const setCriterion = (index: number, part: keyof RuleCriterionDTO, text: string) =>
    set({ criteria: value.criteria.map((each, at) => (at === index ? { ...each, [part]: text } : each)) })
  const toggle = (dimensionId: string, valueId: string, on: boolean) => {
    const picked = (value.scope[dimensionId] ?? []).filter(id => id !== valueId)
    set({ scope: { ...value.scope, [dimensionId]: on ? [...picked, valueId] : picked } })
  }

  return (
    <Stack gap={4}>
      <Field label="Kind">
        <Select value={value.kind} onValueChange={kind => set({ kind: kind as RuleKind })} options={RULE_KINDS.map(kind => ({ value: kind, label: kind }))} />
      </Field>
      <Field label="Statement" description="What must always hold true.">
        <Textarea value={value.statement} rows={2} onChange={statement => set({ statement })} />
      </Field>
      <Field label="Why"><Textarea value={value.why} rows={3} onChange={why => set({ why })} /></Field>
      <Stack gap={2}>
        <Text size="sm" weight="medium">Where it applies</Text>
        <Text size="sm" tone="muted">A dimension with nothing picked applies in all its values.</Text>
        {dimensions.map(dimension => (
          <Inline key={dimension.id} gap={3} wrap>
            <Text size="sm">{dimension.name}:</Text>
            {dimension.values.filter(each => !each.retiredAt).map(each => (
              <Inline key={each.id} gap={1}>
                <Checkbox
                  label={`${dimension.name}: ${each.name}`}
                  checked={(value.scope[dimension.id] ?? []).includes(each.id)}
                  onCheckedChange={on => toggle(dimension.id, each.id, on)}
                />
                <Text size="sm">{each.name}</Text>
              </Inline>
            ))}
          </Inline>
        ))}
      </Stack>
      <Stack gap={2}>
        <Text size="sm" weight="medium">Acceptance criteria</Text>
        {value.criteria.map((criterion, index) => (
          <Stack key={index} gap={2}>
            <Input label={`Criterion ${index + 1}: given`} placeholder="Given…" value={criterion.given} onChange={text => setCriterion(index, 'given', text)} />
            <Input label={`Criterion ${index + 1}: when`} placeholder="When…" value={criterion.when} onChange={text => setCriterion(index, 'when', text)} />
            <Input label={`Criterion ${index + 1}: then`} placeholder="Then…" value={criterion.then} onChange={text => setCriterion(index, 'then', text)} />
            <Inline><Button size="sm" variant="ghost" onClick={() => set({ criteria: value.criteria.filter((_, at) => at !== index) })}>Remove criterion</Button></Inline>
          </Stack>
        ))}
        <Inline><Button size="sm" variant="outline" onClick={() => set({ criteria: [...value.criteria, { given: '', when: '', then: '' }] })}>Add a criterion</Button></Inline>
      </Stack>
    </Stack>
  )
}
