import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../../components/form-field'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { useOpenProposal } from '../../../../services/quick-proposal/use-open-proposal'
import { DefinitionDimensionsRenameService } from './definition-dimensions-rename.service'

/** The dialog to rename a dimension or a value; it opens when the service has a target. */
export function DefinitionDimensionsRename() {
  const rename = useService(DefinitionDimensionsRenameService)
  const target = useValue(rename.target)
  const submitting = useValue(rename.form.submitting)
  const open = useOpenProposal()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void open(rename.save())
  }

  const title = target?.value ? `Propose renaming ${target.value.name}` : `Propose renaming ${target?.dimension.name ?? ''}`

  return (
    <Dialog
      open={target !== null}
      onOpenChange={next => !next && rename.close()}
      title={title}
      description="A quick proposal: once merged, it keeps its identity and whatever uses it follows the new name."
      size="sm"
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4} align="start">
          <FormField form={rename.form} name="name" label="Name" />
          <Button type="submit" loading={submitting}>Propose</Button>
        </Stack>
      </form>
    </Dialog>
  )
}
