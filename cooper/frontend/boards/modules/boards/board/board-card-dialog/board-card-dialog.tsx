import { useEffect, type FormEvent } from 'react'
import { Trash2Icon } from 'lucide-react'
import type { CardDTO } from '@cooper/api/card'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { ConfirmDialog } from '@newt-kit/react-ui/confirm-dialog'
import { Dialog } from '@newt-kit/react-ui/dialog'
import { Grid } from '@newt-kit/react-ui/grid'
import { Icon } from '@newt-kit/react-ui/icon'
import { Inline } from '@newt-kit/react-ui/inline'
import { RelativeTime } from '@newt-kit/react-ui/relative-time'
import { Stack } from '@newt-kit/react-ui/stack'
import { Mono, Text } from '@newt-kit/react-ui/text'
import { FormField } from '@newt-kit/react/form-field'
import { Provide, useService, useValue } from '@newt-kit/react'
import { WorkspaceService } from '../../../workspace/workspace.service'
import { BoardService } from '../board.service'
import { CARD_NOBODY } from '../board-card-form'
import { BoardCardDialogActivity } from './board-card-dialog-activity/board-card-dialog-activity'
import { BoardCardDialogAttachments } from './board-card-dialog-attachments/board-card-dialog-attachments'
import { BoardCardDialogService } from './board-card-dialog.service'

type BoardCardDialogProps = {
  card: CardDTO
  onClose: () => void
}

/** With its own BoardCardDialogService: whoever renders it needs nothing else. */
export function BoardCardDialog(props: BoardCardDialogProps) {
  return (
    <Provide services={[BoardCardDialogService]}>
      <BoardCardDialogWrapped {...props} />
    </Provide>
  )
}

/**
 * A card, opened: its title and description, its column and who it is assigned to,
 * all saved together with Save, which closes it; and deleting it.
 */
function BoardCardDialogWrapped({ card, onClose }: BoardCardDialogProps) {
  const service = useService(BoardCardDialogService)
  const columns = useValue(useService(BoardService).columns)
  const members = useValue(useService(WorkspaceService).members)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const confirmingDelete = useValue(service.confirmingDelete)
  const deleting = useValue(service.deleting)

  useEffect(() => {
    service.edit(card)
  }, [service, card])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.save(card)) onClose()
  }

  async function remove() {
    if (await service.delete(card)) onClose()
  }

  const assignees = [
    { value: CARD_NOBODY, label: 'Nobody' },
    ...members.map(member => ({ value: member.id, label: member.name })),
  ]

  return (
    <>
      <Dialog
        open={!confirmingDelete}
        onOpenChange={open => !open && onClose()}
        title={<>{card.title} <Mono>#{card.number}</Mono></>}
        size="lg"
      >
        <Stack gap={6}>
          <form onSubmit={event => void onSubmit(event)} noValidate>
            <Stack gap={4}>
              {failure && <Alert tone="bad" title="Could not save it">{failure}</Alert>}
              <FormField form={service.form} name="title" label="Title" />
              <FormField form={service.form} name="description" label="Description" rows={6} />
              <Grid columns={{ base: 1, sm: 2 }} gap={4}>
                <FormField form={service.form} name="columnId" label="Column" options={columns.map(column => ({ value: column.id, label: column.name }))} />
                <FormField form={service.form} name="assigneeId" label="Assignee" options={assignees} />
              </Grid>
              <Text size="xs" tone="muted">{'Created '}<RelativeTime date={card.createdAt} />{' · updated '}<RelativeTime date={card.updatedAt} /></Text>
              <Inline justify="between" wrap>
                <Button variant="ghost" onClick={() => service.askDelete()}><Icon icon={Trash2Icon} size="sm" />Delete</Button>
                <Inline gap={2}>
                  <Button variant="outline" onClick={onClose}>Cancel</Button>
                  <Button type="submit" loading={submitting}>Save</Button>
                </Inline>
              </Inline>
            </Stack>
          </form>
          <BoardCardDialogAttachments card={card} />
          <BoardCardDialogActivity card={card} />
        </Stack>
      </Dialog>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={open => !open && service.cancelDelete()}
        title={`Delete #${card.number}?`}
        description="The card is gone for good. Its number is never used again on this board."
        confirmLabel="Delete card"
        tone="destructive"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </>
  )
}
