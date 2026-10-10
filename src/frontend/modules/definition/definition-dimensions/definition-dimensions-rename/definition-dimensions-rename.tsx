import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../../components/form-field'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { DefinitionDimensionsRenameService } from './definition-dimensions-rename.service'

/** The dialog to rename a dimension or a value; it opens when the service has a target. */
export function DefinitionDimensionsRename() {
  const rename = useService(DefinitionDimensionsRenameService)
  const target = useValue(rename.target)
  const submitting = useValue(rename.form.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void rename.save()
  }

  const title = target?.value ? `Rename ${target.value.name}` : `Rename ${target?.dimension.name ?? ''}`

  return (
    <Dialog
      open={target !== null}
      onOpenChange={open => !open && rename.close()}
      title={title}
      description="It keeps its identity: whatever uses it follows the new name."
      size="sm"
    >
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4} align="start">
          <FormField form={rename.form} name="name" label="Name" />
          <Button type="submit" loading={submitting}>Rename</Button>
        </Stack>
      </form>
    </Dialog>
  )
}
