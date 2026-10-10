import type { ReactNode } from 'react'
import { toast as sonnerToast } from 'sonner'
import { Toaster as ShadcnToaster } from '../../shadcn/sonner'

/**
 * Where toasts appear. Render it once, near the root of the app. It follows the
 * `dark` class on <html>, so it needs no theme.
 */
export function Toaster() {
  return <ShadcnToaster />
}

/** What a toast may carry besides its message: nothing that styles it. */
type ToastOptions = {
  description?: ReactNode
  /** Milliseconds. */
  duration?: number
  action?: { label: string, onClick: () => void }
}

const show = (kind: 'success' | 'error' | 'info' | 'message') =>
  (message: ReactNode, options?: ToastOptions) => {
    sonnerToast[kind](message, options)
  }

/** Shows a toast: `toast.success`, `toast.error`, `toast.info` or `toast.message`. */
export const toast = {
  success: show('success'),
  error: show('error'),
  info: show('info'),
  message: show('message'),
}
