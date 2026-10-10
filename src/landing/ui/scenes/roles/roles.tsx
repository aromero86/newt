import type { ReactNode } from 'react'
import { Avatar } from '@newt/ui/components/avatar'

/**
 * Holds the row of role tabs. On phones the row is wider than the screen, so it
 * scrolls sideways, edge to edge, instead of wrapping or being cut off.
 */
export function RoleTabsBar({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">{children}</div>
}

/** What one role's tab shows: who it is, what they get, and their scenario. */
export function RolePanel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6">{children}</div>
}

/** "Lucía, product. Changes the product by…", next to her avatar. */
export function RoleIntro({ person, seat, gets }: { person: string; seat: string; gets: string }) {
  return (
    <div className="flex max-w-3xl items-start gap-3">
      <div className="mt-0.5 flex shrink-0">
        <Avatar name={person} size={8} />
      </div>
      <p className="text-pretty text-muted-foreground">
        <span className="font-medium text-foreground">
          {person}, {seat}.
        </span>{' '}
        {gets}
      </p>
    </div>
  )
}
