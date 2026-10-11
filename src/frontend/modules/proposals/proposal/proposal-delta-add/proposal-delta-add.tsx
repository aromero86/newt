import type { FormEvent } from 'react'
import type { RuleKind } from '@newt/api/rule'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Checkbox } from '@newt/ui/components/checkbox'
import { Dialog } from '@newt/ui/components/dialog'
import { Field } from '@newt/ui/components/field'
import { Inline } from '@newt/ui/components/inline'
import { Input } from '@newt/ui/components/input'
import { Select } from '@newt/ui/components/select'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Textarea } from '@newt/ui/components/textarea'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { ProposalService } from '../proposal.service'
import { DELTA_CHOICES, ProposalDeltaAddService, type DeltaChoice } from './proposal-delta-add.service'

const RULE_KINDS: RuleKind[] = ['permission', 'validation', 'flow', 'calculation', 'legal', 'non-functional']

/** With its own ProposalDeltaAddService: a button that opens the dialog to write a delta by hand. */
export function ProposalDeltaAdd() {
  return (
    <Provide services={[ProposalDeltaAddService]}>
      <ProposalDeltaAddWrapped />
    </Provide>
  )
}

function ProposalDeltaAddWrapped() {
  const service = useService(ProposalDeltaAddService)
  const open = useValue(service.open)
  const choice = useValue(service.choice)
  const failure = useValue(service.failure)
  const submitting = useValue(service.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.submit()
  }

  return (
    <>
      <Inline>
        <Button variant="secondary" onClick={() => service.start()}>Add a delta</Button>
      </Inline>
      <Dialog open={open} onOpenChange={next => !next && service.close()} title="Add a delta" description="One change to one artifact of the definition." size="lg">
        <form onSubmit={onSubmit} noValidate>
          <Stack gap={4}>
            <Field label="What it does">
              <Select
                value={choice}
                placeholder="Pick a change"
                onValueChange={value => void service.choose(value as DeltaChoice)}
                options={Object.entries(DELTA_CHOICES).map(([value, label]) => ({ value, label }))}
              />
            </Field>
            {choice && <ProposalDeltaAddTarget />}
            {choice && <ProposalDeltaAddFields />}
            {failure && <Alert tone="bad" title="The delta cannot be added">{failure}</Alert>}
            {choice && (
              <Inline>
                <Button type="submit" loading={submitting}>Add delta</Button>
              </Inline>
            )}
          </Stack>
        </form>
      </Dialog>
    </>
  )
}

/** What the delta changes: an area, a feature, a rule or a dimension, picked from the definition. */
function ProposalDeltaAddTarget() {
  const service = useService(ProposalDeltaAddService)
  const choice = useValue(service.choice)!
  const areas = useValue(service.areas.items)
  const areasMore = useValue(service.areas.hasMore)
  const features = useValue(service.features.items)
  const featuresMore = useValue(service.features.hasMore)
  const areaId = useValue(service.areaId)
  const featureId = useValue(service.featureId)
  const dimensionId = useValue(service.dimensionId)
  const ruleKey = useValue(service.ruleKey)
  const rule = useValue(service.rule)
  const dimensions = useValue(useService(ProposalService).dimensions)

  const needsArea = choice.startsWith('feature') && choice !== 'feature-area:create' || choice === 'rule:create'
  const needsFeature = (choice.startsWith('feature:') && choice !== 'feature:create') || choice === 'rule:create'

  return (
    <Stack gap={4}>
      {needsArea && (
        <Field label={choice.startsWith('feature-area') ? 'Area' : 'In area'}>
          <Select value={areaId} placeholder="Pick an area" onValueChange={value => void service.pickArea(value)} options={areas.map(area => ({ value: area.id, label: area.name }))} />
        </Field>
      )}
      {needsArea && areasMore && <Inline><Button size="sm" variant="ghost" onClick={() => void service.areas.loadMore()}>Load more areas</Button></Inline>}
      {needsFeature && areaId && (
        <Field label="Feature">
          <Select value={featureId} placeholder="Pick a feature" onValueChange={value => service.pickFeature(value)} options={features.map(feature => ({ value: feature.id, label: feature.name }))} />
        </Field>
      )}
      {needsFeature && areaId && featuresMore && <Inline><Button size="sm" variant="ghost" onClick={() => void service.features.loadMore()}>Load more features</Button></Inline>}
      {(choice === 'rule:change' || choice === 'rule:retire') && (
        <Inline gap={2} align="end">
          <Field label="Rule">
            <Input value={ruleKey} placeholder="R-7" onChange={value => service.set('ruleKey', value)} />
          </Field>
          <Button variant="outline" onClick={() => void service.findRule()}>Find</Button>
        </Inline>
      )}
      {rule && <Text size="sm" tone="muted">{`${rule.key} · ${rule.featureName} · ${rule.current.statement}`}</Text>}
      {choice === 'dimension:change' && (
        <Field label="Dimension">
          <Select
            value={dimensionId}
            placeholder="Pick a dimension"
            onValueChange={value => service.pickDimension(dimensions.find(dimension => dimension.id === value)!)}
            options={dimensions.map(dimension => ({ value: dimension.id, label: dimension.name }))}
          />
        </Field>
      )}
    </Stack>
  )
}

/** The state the delta leaves its target in; retiring and restoring need none. */
function ProposalDeltaAddFields() {
  const service = useService(ProposalDeltaAddService)
  const choice = useValue(service.choice)!
  const areas = useValue(service.areas.items)
  const moveToAreaId = useValue(service.moveToAreaId)
  const name = useValue(service.name)
  const description = useValue(service.description)
  const ruleKind = useValue(service.ruleKind)
  const statement = useValue(service.statement)
  const why = useValue(service.why)
  const scope = useValue(service.scope)
  const criteria = useValue(service.criteria)
  const values = useValue(service.values)
  const newValues = useValue(service.newValues)
  const rule = useValue(service.rule)
  const featureId = useValue(service.featureId)
  const dimensionId = useValue(service.dimensionId)
  const dimensions = useValue(useService(ProposalService).dimensions)

  if (choice.endsWith(':retire') || choice.endsWith(':restore')) return null

  if (choice.startsWith('feature-area') || choice.startsWith('feature:')) {
    if (choice === 'feature:change' && !featureId) return null
    return (
      <Stack gap={4}>
        {choice === 'feature:change' && (
          <Field label="Area it ends up in">
            <Select value={moveToAreaId} onValueChange={value => service.set('moveToAreaId', value)} options={areas.map(area => ({ value: area.id, label: area.name }))} />
          </Field>
        )}
        <Field label="Name"><Input value={name} onChange={value => service.set('name', value)} /></Field>
        <Field label="Description" description="What it covers, and what it does not.">
          <Textarea value={description} rows={4} onChange={value => service.set('description', value)} />
        </Field>
      </Stack>
    )
  }

  if (choice.startsWith('rule')) {
    if (choice === 'rule:change' && !rule) return null
    if (choice === 'rule:create' && !featureId) return null
    return (
      <Stack gap={4}>
        <Field label="Kind">
          <Select value={ruleKind} onValueChange={value => service.set('ruleKind', value as RuleKind)} options={RULE_KINDS.map(kind => ({ value: kind, label: kind }))} />
        </Field>
        <Field label="Statement" description="What must always hold true.">
          <Textarea value={statement} rows={2} onChange={value => service.set('statement', value)} />
        </Field>
        <Field label="Why"><Textarea value={why} rows={3} onChange={value => service.set('why', value)} /></Field>
        <Stack gap={2}>
          <Text size="sm" weight="medium">Where it applies</Text>
          <Text size="sm" tone="muted">A dimension with nothing picked applies in all its values.</Text>
          {dimensions.map(dimension => (
            <Inline key={dimension.id} gap={3} wrap>
              <Text size="sm">{dimension.name}:</Text>
              {dimension.values.filter(value => !value.retiredAt).map(value => (
                <Inline key={value.id} gap={1}>
                  <Checkbox
                    label={`${dimension.name}: ${value.name}`}
                    checked={(scope[dimension.id] ?? []).includes(value.id)}
                    onCheckedChange={on => service.toggleScope(dimension.id, value.id, on)}
                  />
                  <Text size="sm">{value.name}</Text>
                </Inline>
              ))}
            </Inline>
          ))}
        </Stack>
        <Stack gap={2}>
          <Text size="sm" weight="medium">Acceptance criteria</Text>
          {criteria.map((criterion, index) => (
            <Stack key={index} gap={2}>
              <Input label={`Criterion ${index + 1}: given`} placeholder="Given…" value={criterion.given} onChange={value => service.setCriterion(index, 'given', value)} />
              <Input label={`Criterion ${index + 1}: when`} placeholder="When…" value={criterion.when} onChange={value => service.setCriterion(index, 'when', value)} />
              <Input label={`Criterion ${index + 1}: then`} placeholder="Then…" value={criterion.then} onChange={value => service.setCriterion(index, 'then', value)} />
              <Inline><Button size="sm" variant="ghost" onClick={() => service.removeCriterion(index)}>Remove criterion</Button></Inline>
            </Stack>
          ))}
          <Inline><Button size="sm" variant="outline" onClick={() => service.addCriterion()}>Add a criterion</Button></Inline>
        </Stack>
      </Stack>
    )
  }

  if (choice === 'dimension:change' && !dimensionId) return null
  return (
    <Stack gap={4}>
      <Field label="Name"><Input value={name} onChange={value => service.set('name', value)} /></Field>
      {values.map((value, index) => (
        <Inline key={value.id ?? index} gap={2}>
          <Input label={`Value ${index + 1}`} value={value.name} onChange={next => service.setValue(index, { name: next })} />
          <Checkbox label={`Retire ${value.name}`} checked={value.retired} onCheckedChange={on => service.setValue(index, { retired: on })} />
          <Text size="sm" tone="muted">retired</Text>
        </Inline>
      ))}
      <Field label="New values" description="One per line.">
        <Textarea value={newValues} rows={3} onChange={value => service.set('newValues', value)} />
      </Field>
    </Stack>
  )
}
