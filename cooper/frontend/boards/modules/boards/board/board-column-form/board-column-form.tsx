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
import { BoardColumnFormService } from './board-column-form.service'

type BoardColumnFormProps = {
  /** The column to rename, or `null` to add one. */
  column: ColumnDTO | null
  onClose: () => void
}

/** With its own BoardColumnFormService: whoever renders it needs nothing else. */
export function BoardColumnForm(props: BoardColumnFormProps) {
  return (
    <Provide services={[BoardColumnFormService]}>
      <BoardColumnFormWrapped {...props} />
    </Provide>
  )
}

/** The dialog that names a column: a new one, or one to rename. Shown while it is rendered. */
function BoardColumnFormWrapped({ column, onClose }: BoardColumnFormProps) {
  const service = useService(BoardColumnFormService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  useEffect(() => {
    service.start(column)
  }, [service, column])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit()) onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={open => !open && onClose()}
      title={column ? `Rename ${column.name}` : 'Add a column'}
      description={column ? undefined : 'It goes at the end of the board. A board has at most 10 columns.'}
      size="sm"
    >
      <form onSubmit={event => void onSubmit(event)} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not save it">{failure}</Alert>}
          <FormField form={service.form} name="name" label="Name" placeholder="In review" />
          <Inline justify="end" gap={2}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={submitting}>{column ? 'Rename' : 'Add column'}</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
