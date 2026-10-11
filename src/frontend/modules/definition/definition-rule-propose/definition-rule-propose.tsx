import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { RuleDraftFields } from '../../../components/rule-draft-fields'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { useOpenProposal } from '../../../services/quick-proposal/use-open-proposal'
import { DefinitionRuleProposeService } from './definition-rule-propose.service'

/** The dialog to propose a rule or a new version of one; it opens when its service starts. */
export function DefinitionRulePropose() {
  const service = useService(DefinitionRuleProposeService)
  const open = useValue(service.open)
  const rule = useValue(service.rule)
  const value = useValue(service.value)
  const dimensions = useValue(service.dimensions)
  const submitting = useValue(service.submitting)
  const openProposal = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void openProposal(service.submit())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && service.close()}
      title={rule ? `Propose a new version of ${rule.key}` : 'Propose a rule'}
      description="It goes in a quick proposal, to approve. A rule is never edited: a new version replaces it."
      size="lg"
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <RuleDraftFields value={value} dimensions={dimensions} onChange={next => service.change(next)} />
          <Inline><Button type="submit" loading={submitting}>Propose</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
