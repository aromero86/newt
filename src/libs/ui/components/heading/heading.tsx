import type { ReactNode } from 'react'
import { cn } from 'cn'

type Level = 1 | 2 | 3 | 4

const levelClass: Record<Level, string> = {
  1: 'text-4xl font-bold tracking-tight',
  2: 'text-3xl font-semibold tracking-tight',
  3: 'text-2xl font-semibold',
  4: 'text-xl font-semibold',
}

type HeadingProps = {
  level: Level
  children: ReactNode
}

export function Heading({ level, children }: HeadingProps) {
  const Tag = `h${level}` as const
  return <Tag className={cn(levelClass[level])}>{children}</Tag>
}
