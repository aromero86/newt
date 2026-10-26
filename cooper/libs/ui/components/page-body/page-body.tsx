import type { ReactNode } from 'react'
import { cn } from 'cn'

const widths = {
  /** A form on its own: sign in, a new workspace. */
  narrow: 'max-w-screen-sm',
  /** Settings and documents. */
  medium: 'max-w-screen-lg',
  /** Lists and pages with a sidebar. */
  wide: 'max-w-screen-xl',
}

/** The content of a page, centred, with the room around it every page shares. */
export function PageBody({ width = 'wide', children }: { width?: keyof typeof widths, children: ReactNode }) {
  return <div className={cn('mx-auto w-full px-4 py-6 md:px-6 md:py-8', widths[width])}>{children}</div>
}
