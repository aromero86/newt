import type { ReactNode } from 'react'

/** A small number in a pill, like GitHub's: how many there are. */
export function Counter({ children }: { children: ReactNode }) {
  return <span className="inline-flex min-w-5 items-center justify-center rounded-sm bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums">{children}</span>
}
