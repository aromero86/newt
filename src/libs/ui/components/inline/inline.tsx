import type { ReactNode } from 'react'
import { cn } from 'cn'
import { type Align, type Justify, type Space, alignClass, gapClass, justifyClass } from '../../tokens'

type InlineProps = {
  gap?: Space
  align?: Align
  justify?: Justify
  wrap?: boolean
  children: ReactNode
}

/** Lays its children out horizontally. */
export function Inline({ gap = 2, align = 'center', justify = 'start', wrap = false, children }: InlineProps) {
  return (
    <div className={cn('flex flex-row', gapClass[gap], alignClass[align], justifyClass[justify], wrap && 'flex-wrap')}>
      {children}
    </div>
  )
}
