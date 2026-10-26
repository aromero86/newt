import { useEffect, type FormEvent } from 'react'
import type { ColumnDTO } from '@cooper/api/column'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Dialog } from '@cooper/ui/components/dialog'
import { Inline } from '@cooper/ui/components/inline'
import { Stack } from '@cooper/ui/components/stack'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { BoardCardNewService } from './board-card-new.service'

type BoardCardNewProps = {
  /** Where the card goes, at the bottom. */
  column: ColumnDTO
  onClose: () => void
}

/** With its own BoardCardNewService: whoever renders it needs nothing else. */
export function BoardCardNew(props: BoardCardNewProps) {
  return (
    <Provide services={[BoardCardNewService]}>
      <BoardCardNewWrapped {...props} />
    </Provide>
  )
}

/** The dialog that adds a card to a column. Shown while it is rendered. */
function BoardCardNewWrapped({ column, onClose }: BoardCardNewProps) {
  const service = useService(BoardCardNewService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  useEffect(() => {
    service.start(column.id)
  }, [service, column.id])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit()) onClose()
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()} title={`New card in ${column.name}`}>
      <form onSubmit={event => void onSubmit(event)} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not create it">{failure}</Alert>}
          <FormField form={service.form} name="title" label="Title" placeholder="What needs doing" />
          <FormField form={service.form} name="description" label="Description" description="Optional." rows={4} />
          <Inline justify="end" gap={2}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create card</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
