import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../components/form-field'
import type { FormStore } from '../../../core/form/form-store'
import { useValue } from '../../../core/store/use-value'

type DefinitionEditDialogProps = {
  form: FormStore<{ name: string, description: string }, unknown>
  open: boolean
  title: string
  onClose: () => void
  onSubmit: () => void
}

/** Edits the name and description of an area or a feature. */
export function DefinitionEditDialog({ form, open, title, onClose, onSubmit }: DefinitionEditDialogProps) {
  const submitting = useValue(form.submitting)

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()} title={title} size="md">
      <form onSubmit={submit} noValidate>
        <Stack gap={4} align="stretch">
          <FormField form={form} name="name" label="Name" />
          <FormField form={form} name="description" label="Description" description="What it covers, and what it does not." rows={5} />
          <Inline>
            <Button type="submit" loading={submitting}>Save</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
