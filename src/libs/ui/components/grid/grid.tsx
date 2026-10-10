import type { ReactNode } from 'react'
import { cn } from 'cn'
import { type Space, gapClass } from '../../tokens'

type Columns = 1 | 2 | 3 | 4 | 6 | 12

/** Columns per breakpoint: `{ base: 1, md: 2 }` is one column on phones and two from md up. */
type ResponsiveColumns = { base: Columns; sm?: Columns; md?: Columns; lg?: Columns }

const columnsClass = {
  base: { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 6: 'grid-cols-6', 12: 'grid-cols-12' },
  sm: { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4', 6: 'sm:grid-cols-6', 12: 'sm:grid-cols-12' },
  md: { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 6: 'md:grid-cols-6', 12: 'md:grid-cols-12' },
  lg: { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 6: 'lg:grid-cols-6', 12: 'lg:grid-cols-12' },
} satisfies Record<keyof ResponsiveColumns, Record<Columns, string>>

type GridProps = {
  columns: Columns | ResponsiveColumns
  gap?: Space
  children: ReactNode
}

/** Lays its children out in equal-width columns. */
export function Grid({ columns, gap = 4, children }: GridProps) {
  const responsive = typeof columns === 'number' ? { base: columns } : columns
  const classes = (Object.keys(responsive) as (keyof ResponsiveColumns)[]).map(breakpoint => {
    const count = responsive[breakpoint]
    return count === undefined ? undefined : columnsClass[breakpoint][count]
  })
  return <div className={cn('grid', classes, gapClass[gap])}>{children}</div>
}
