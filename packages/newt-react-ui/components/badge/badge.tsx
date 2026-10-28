import { useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { Badge as ShadcnBadge } from '../../internal/badge'
import { LinkComponentContext } from '../link/link-component'

type Tone = 'primary' | 'secondary' | 'outline' | 'muted' | 'ok' | 'warn' | 'bad' | 'info' | 'brand'

// The state tones are tinted versions of the outline badge; as a link, they darken a little when pointed at.
const look: Record<Tone, { variant: 'default' | 'secondary' | 'outline'; className?: string }> = {
  primary: { variant: 'default' },
  secondary: { variant: 'secondary' },
  outline: { variant: 'outline' },
  muted: { variant: 'secondary', className: 'bg-muted text-muted-foreground [a&]:hover:bg-accent' },
  ok: { variant: 'outline', className: 'border-ok/30 bg-ok/12 text-ok [a&]:hover:bg-ok/20 [a&]:hover:text-ok' },
  warn: { variant: 'outline', className: 'border-warn/30 bg-warn/12 text-warn [a&]:hover:bg-warn/20 [a&]:hover:text-warn' },
  bad: { variant: 'outline', className: 'border-bad/30 bg-bad/12 text-bad [a&]:hover:bg-bad/20 [a&]:hover:text-bad' },
  info: { variant: 'outline', className: 'border-info/30 bg-info/12 text-info [a&]:hover:bg-info/20 [a&]:hover:text-info' },
  brand: { variant: 'outline', className: 'border-brand/30 bg-brand/12 text-brand [a&]:hover:bg-brand/20 [a&]:hover:text-brand' },
}

type BadgeProps = {
  tone?: Tone
  /** With `href` the badge is a link, through the app's router: to where its state is told in full. */
  href?: string
  /** Accessible name, when the badge alone does not say where it goes. */
  label?: string
  children: ReactNode
}

export function Badge({ tone = 'primary', href, label, children }: BadgeProps) {
  const Link = useContext(LinkComponentContext)
  if (href !== undefined) {
    return (
      <ShadcnBadge variant={look[tone].variant} className={cn(look[tone].className)} asChild>
        <Link href={href} aria-label={label}>{children}</Link>
      </ShadcnBadge>
    )
  }
  return (
    <ShadcnBadge variant={look[tone].variant} className={cn(look[tone].className)}>
      {children}
    </ShadcnBadge>
  )
}
