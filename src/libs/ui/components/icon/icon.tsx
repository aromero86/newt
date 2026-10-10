import type { ComponentType } from 'react'
import { cn } from 'cn'

/** Any icon component that takes a class name: lucide-react icons, or our own SVGs. */
export type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>

type Size = 'xs' | 'sm' | 'md' | 'lg'

const sizeClass: Record<Size, string> = {
  xs: 'size-3',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
}

type Tone = 'current' | 'muted' | 'brand' | 'ok' | 'warn' | 'bad' | 'info'

const toneClass: Record<Tone, string> = {
  current: '',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
}

type IconProps = {
  icon: IconComponent
  size?: Size
  tone?: Tone
}

/** A decorative icon. Buttons and links that only show an icon carry their own label. */
export function Icon({ icon: Glyph, size = 'md', tone = 'current' }: IconProps) {
  return <Glyph aria-hidden className={cn('shrink-0', sizeClass[size], toneClass[tone])} />
}
