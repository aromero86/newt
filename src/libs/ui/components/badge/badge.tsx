import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Badge as ShadcnBadge } from '../../shadcn/badge'

type Tone = 'primary' | 'secondary' | 'outline' | 'muted' | 'ok' | 'warn' | 'bad' | 'info' | 'brand'

// The state tones are tinted versions of the outline badge.
const look: Record<Tone, { variant: 'default' | 'secondary' | 'outline'; className?: string }> = {
  primary: { variant: 'default' },
  secondary: { variant: 'secondary' },
  outline: { variant: 'outline' },
  muted: { variant: 'secondary', className: 'bg-muted text-muted-foreground' },
  ok: { variant: 'outline', className: 'border-ok/30 bg-ok/12 text-ok' },
  warn: { variant: 'outline', className: 'border-warn/30 bg-warn/12 text-warn' },
  bad: { variant: 'outline', className: 'border-bad/30 bg-bad/12 text-bad' },
  info: { variant: 'outline', className: 'border-info/30 bg-info/12 text-info' },
  brand: { variant: 'outline', className: 'border-brand/30 bg-brand/12 text-brand' },
}

type BadgeProps = {
  tone?: Tone
  children: ReactNode
}

export function Badge({ tone = 'primary', children }: BadgeProps) {
  return (
    <ShadcnBadge variant={look[tone].variant} className={cn(look[tone].className)}>
      {children}
    </ShadcnBadge>
  )
}
