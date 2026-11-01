import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { Dialog } from '@newt-kit/react-ui/dialog'
import { Inline } from '@newt-kit/react-ui/inline'
import { Stack } from '@newt-kit/react-ui/stack'
import { FormField } from '@newt-kit/react/form-field'
import { useService, useValue } from '@newt-kit/react'
import { BoardsListService } from './boards-list.service'

/** The dialog to create a board; its service opens it. A new board opens at once. */
export function BoardsListNew() {
  const workspaceId = useParams().workspaceId!
  const service = useService(BoardsListService)
  const open = useValue(service.creating)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const board = await service.create()
    if (board) navigate(`/w/${workspaceId}/boards/${board.id}`)
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.closeCreate()} title="New board" description="It starts empty: add its columns once it is open.">
      <form onSubmit={event => void onSubmit(event)} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not create it">{failure}</Alert>}
          <FormField form={service.form} name="name" label="Name" placeholder="Roadmap" />
          <FormField form={service.form} name="description" label="Description" description="Optional: what the board is for." rows={3} />
          <Inline justify="end" gap={2}>
            <Button variant="outline" onClick={() => service.closeCreate()}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create board</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
