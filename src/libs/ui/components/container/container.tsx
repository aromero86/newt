import type { ReactNode } from 'react'
import { cn } from 'cn'

type Size = 'sm' | 'md' | 'lg' | 'xl'

const sizeClass: Record<Size, string> = {
  sm: 'max-w-screen-sm',
  md: 'max-w-screen-md',
  lg: 'max-w-screen-lg',
  xl: 'max-w-screen-xl',
}

type ContainerProps = {
  size?: Size
  children: ReactNode
}

/** Centers its content and caps its width. */
export function Container({ size = 'lg', children }: ContainerProps) {
  return <div className={cn('mx-auto w-full px-4', sizeClass[size])}>{children}</div>
}
