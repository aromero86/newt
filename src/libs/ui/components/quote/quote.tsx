import type { ReactNode } from 'react'

/** Words taken from somewhere else, as they were: a sentence of a document, for one. */
export function Quote({ children }: { children: ReactNode }) {
  return <blockquote className="border-l-2 border-warn/60 pl-3 text-sm text-muted-foreground italic">{children}</blockquote>
}
