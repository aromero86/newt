import type { ReactNode } from 'react'
import { cn } from 'cn'
import { type Align, type Space, alignClass, gapClass } from '../../tokens'

type StackProps = {
  gap?: Space
  align?: Align
  children: ReactNode
}

/** Lays its children out vertically. */
export function Stack({ gap = 4, align = 'stretch', children }: StackProps) {
  return <div className={cn('flex flex-col', gapClass[gap], alignClass[align])}>{children}</div>
}
