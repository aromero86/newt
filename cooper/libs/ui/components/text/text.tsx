import type { ReactNode } from 'react'
import { cn } from 'cn'

type Size = 'xs' | 'sm' | 'md' | 'lg'

const sizeClass: Record<Size, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
}

type Tone = 'default' | 'muted' | 'destructive'

const toneClass: Record<Tone, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  destructive: 'text-destructive',
}

type Weight = 'normal' | 'medium' | 'semibold'

const weightClass: Record<Weight, string> = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
}

type TextProps = {
  size?: Size
  tone?: Tone
  weight?: Weight
  /** `p` for a paragraph, `span` for text inside other text. */
  as?: 'p' | 'span'
  children: ReactNode
}

export function Text({ size = 'md', tone = 'default', weight = 'normal', as: Tag = 'p', children }: TextProps) {
  return <Tag className={cn(sizeClass[size], toneClass[tone], weightClass[weight])}>{children}</Tag>
}
