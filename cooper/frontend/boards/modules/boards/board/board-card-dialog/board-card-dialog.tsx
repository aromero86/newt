import { useEffect, type FormEvent } from 'react'
import { Trash2Icon } from 'lucide-react'
import type { CardDTO } from '@cooper/api/card'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { ConfirmDialog } from '@cooper/ui/components/confirm-dialog'
import { Dialog } from '@cooper/ui/components/dialog'
import { Field } from '@cooper/ui/components/field'
import { Grid } from '@cooper/ui/components/grid'
import { Icon } from '@cooper/ui/components/icon'
import { Inline } from '@cooper/ui/components/inline'
import { RelativeTime } from '@cooper/ui/components/relative-time'
import { Select } from '@cooper/ui/components/select'
import { Stack } from '@cooper/ui/components/stack'
import { Mono, Text } from '@cooper/ui/components/text'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { WorkspaceService } from '../../../workspace/workspace.service'
import { BoardService } from '../board.service'
import { BoardCardDialogActivity } from './board-card-dialog-activity/board-card-dialog-activity'
import { BoardCardDialogService } from './board-card-dialog.service'

/** What the assignee picker says for nobody: Radix's select takes no empty value. */
const NOBODY = 'nobody'

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

/** A card, opened: its title and description, its column, who it is assigned to, and deleting it. */
function BoardCardDialogWrapped({ card, onClose }: BoardCardDialogProps) {
  const service = useService(BoardCardDialogService)
  const board = useService(BoardService)
  const columns = useValue(board.columns)
  const members = useValue(useService(WorkspaceService).members)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const confirmingDelete = useValue(service.confirmingDelete)
  const deleting = useValue(service.deleting)

  useEffect(() => {
    service.edit(card)
  }, [service, card])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.save(card)
  }

  async function remove() {
    if (await service.delete(card)) onClose()
  }

  const assignees = [
    { value: NOBODY, label: 'Nobody' },
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
          <Grid columns={{ base: 1, sm: 2 }} gap={4}>
            <Field label="Column">
              <Select
                value={card.columnId}
                options={columns.map(column => ({ value: column.id, label: column.name }))}
                onValueChange={columnId => columnId !== card.columnId && void board.moveCard(card, columnId)}
              />
            </Field>
            <Field label="Assignee">
              <Select
                value={card.assigneeId ?? NOBODY}
                options={assignees}
                onValueChange={value => void board.assignCard(card, value === NOBODY ? null : value)}
              />
            </Field>
          </Grid>
          <form onSubmit={onSubmit} noValidate>
            <Stack gap={4}>
              {failure && <Alert tone="bad" title="Could not save it">{failure}</Alert>}
              <FormField form={service.form} name="title" label="Title" />
              <FormField form={service.form} name="description" label="Description" rows={6} />
              <Inline justify="between" wrap>
                <Text size="xs" tone="muted">{'Created '}<RelativeTime date={card.createdAt} />{' · updated '}<RelativeTime date={card.updatedAt} /></Text>
                <Inline gap={2}>
                  <Button variant="ghost" onClick={() => service.askDelete()}><Icon icon={Trash2Icon} size="sm" />Delete</Button>
                  <Button type="submit" loading={submitting}>Save</Button>
                </Inline>
              </Inline>
            </Stack>
          </form>
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
