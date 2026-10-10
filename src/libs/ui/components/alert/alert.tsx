import type { ReactNode } from 'react'
import { cn } from 'cn'
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert as ShadcnAlert, AlertDescription as ShadcnAlertDescription, AlertTitle as ShadcnAlertTitle } from '../../shadcn/alert'
import type { IconComponent } from '../icon'

type Tone = 'info' | 'ok' | 'warn' | 'bad'

const look: Record<Tone, { icon: IconComponent; className: string; role: 'status' | 'alert' }> = {
  info: { icon: InfoIcon, className: 'border-info/30 bg-info/10 text-info', role: 'status' },
  ok: { icon: CircleCheckIcon, className: 'border-ok/30 bg-ok/10 text-ok', role: 'status' },
  warn: { icon: TriangleAlertIcon, className: 'border-warn/30 bg-warn/10 text-warn', role: 'alert' },
  bad: { icon: OctagonXIcon, className: 'border-bad/30 bg-bad/10 text-bad', role: 'alert' },
}

type AlertProps = {
  tone?: Tone
  title: ReactNode
  /** More detail under the title. */
  children?: ReactNode
}

/**
 * A message about the page or an action. `warn` and `bad` are announced right
 * away (role="alert"); `info` and `ok` politely (role="status").
 */
export function Alert({ tone = 'info', title, children }: AlertProps) {
  const { icon: Glyph, className, role } = look[tone]
  return (
    <ShadcnAlert role={role} className={cn(className)}>
      <Glyph aria-hidden />
      <ShadcnAlertTitle>{title}</ShadcnAlertTitle>
      {children !== undefined && <ShadcnAlertDescription className="text-foreground/80">{children}</ShadcnAlertDescription>}
    </ShadcnAlert>
  )
}
