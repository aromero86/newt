import type { ReactNode } from 'react'
import { Button } from '../button'
import { Dialog } from '../dialog'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** What happens, in a sentence: "The board and its cards are gone for good." */
  description?: ReactNode
  /** The confirming button's text: says the action, "Delete workspace", never "OK". */
  confirmLabel: string
  /** `destructive` for what cannot be undone. */
  tone?: 'default' | 'destructive'
  /** While the action runs: the button spins and cannot be pressed again. */
  loading?: boolean
  onConfirm: () => void
  /** More detail between the description and the buttons. */
  children?: ReactNode
}

/** Asks before doing something that matters. Cancel, Escape and a click outside all close it. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, tone = 'default', loading = false, onConfirm, children }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      footer={(
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={tone === 'destructive' ? 'destructive' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {children}
    </Dialog>
  )
}
