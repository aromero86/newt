import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Reveal } from '../../motion/reveal'

/** The bento grid that holds the infographic cards: 1, 2 and 6 columns. */
export function Bento({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">{children}</div>
}

const sizeClass = {
  /** A third of the row on large screens, the full row on medium. */
  third: 'md:col-span-2 lg:col-span-2',
  /** Two thirds of the row on large screens, the full row on medium. */
  'two-thirds': 'md:col-span-2 lg:col-span-4',
  /** Half the row from medium up. */
  half: 'lg:col-span-3',
}

/** One cell of the bento grid, revealed when it scrolls into view. */
export function BentoCell({ size, delay, children }: { size: keyof typeof sizeClass; delay?: number; children: ReactNode }) {
  return (
    <Reveal className={cn('flex min-w-0', sizeClass[size])} delay={delay}>
      {children}
    </Reveal>
  )
}
