import type { ReactNode } from 'react'
import { cn } from 'cn'
import {
  Dialog as ShadcnDialog,
  DialogContent as ShadcnDialogContent,
  DialogDescription as ShadcnDialogDescription,
  DialogFooter as ShadcnDialogFooter,
  DialogHeader as ShadcnDialogHeader,
  DialogTitle as ShadcnDialogTitle,
} from '../../shadcn/dialog'

type Size = 'sm' | 'md' | 'lg'

const sizeClass: Record<Size, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
}

type DialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  size?: Size
  /** The dialog's body. */
  children?: ReactNode
  /** The dialog's actions, usually buttons. */
  footer?: ReactNode
}

/**
 * A modal dialog. It traps focus while open and closes on Escape, on the close
 * button and on a click outside; all of them call `onOpenChange(false)`.
 */
export function Dialog({ open, onOpenChange, title, description, size = 'md', children, footer }: DialogProps) {
  return (
    <ShadcnDialog open={open} onOpenChange={onOpenChange}>
      <ShadcnDialogContent
        className={cn('max-h-[calc(100dvh-2rem)] overflow-y-auto', sizeClass[size])}
        // Without a description there is nothing to point at.
        {...(description === undefined ? { 'aria-describedby': undefined } : {})}
      >
        <ShadcnDialogHeader>
          <ShadcnDialogTitle>{title}</ShadcnDialogTitle>
          {description !== undefined && <ShadcnDialogDescription>{description}</ShadcnDialogDescription>}
        </ShadcnDialogHeader>
        {children !== undefined && <div className="min-w-0 text-sm">{children}</div>}
        {footer !== undefined && <ShadcnDialogFooter>{footer}</ShadcnDialogFooter>}
      </ShadcnDialogContent>
    </ShadcnDialog>
  )
}
