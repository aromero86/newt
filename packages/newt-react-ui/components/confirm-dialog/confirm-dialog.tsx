import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../button'
import { Dialog } from '../dialog'
import { Field } from '../field'
import { Input } from '../input'

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
  /**
   * A text to type before it can be confirmed, as GitHub asks a repository's name
   * before deleting it: for what cannot be undone and is easy to do by mistake.
   */
  confirmWith?: string
  /** More detail between the description and the buttons. */
  children?: ReactNode
}

/** Asks before doing something that matters. Cancel, Escape and a click outside all close it. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, tone = 'default', loading = false, onConfirm, confirmWith, children }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  // Each time it opens, it asks again.
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  const confirmed = confirmWith === undefined || typed === confirmWith

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
          <Button variant={tone === 'destructive' ? 'destructive' : 'primary'} loading={loading} disabled={!confirmed} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      {confirmWith === undefined ? children : (
        <div className="flex flex-col gap-4">
          {children}
          <Field label={<>To confirm, type <strong className="font-semibold">{confirmWith}</strong></>}>
            <Input value={typed} onChange={setTyped} autoComplete="off" />
          </Field>
        </div>
      )}
    </Dialog>
  )
}
