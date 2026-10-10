import type { ReactNode } from 'react'
import { cn } from 'cn'
import { type Space, gapClass } from '../../tokens'

type Columns = 1 | 2 | 3 | 4 | 6 | 12

const columnsClass: Record<Columns, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  6: 'grid-cols-6',
  12: 'grid-cols-12',
}

type GridProps = {
  columns: Columns
  gap?: Space
  children: ReactNode
}

/** Lays its children out in equal-width columns. */
export function Grid({ columns, gap = 4, children }: GridProps) {
  return <div className={cn('grid', columnsClass[columns], gapClass[gap])}>{children}</div>
}
