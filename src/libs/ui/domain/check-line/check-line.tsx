import type { ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import { cn } from 'cn'
import type { CheckResult } from '../types'

const icon = {
  pass: CheckCircle2Icon,
  fail: XCircleIcon,
  warn: AlertTriangleIcon,
} satisfies Record<CheckResult, unknown>

const look: Record<CheckResult, string> = {
  pass: 'text-ok',
  fail: 'text-bad',
  warn: 'text-warn',
}

/** One line of a newt check report: ✔ ✖ ⚠ plus what it is about. */
export function CheckLine({ result, children }: { result: CheckResult; children: ReactNode }) {
  const Glyph = icon[result]
  return (
    <div className="flex items-start gap-2 text-xs leading-relaxed">
      <Glyph aria-hidden className={cn('mt-0.5 size-3.5 shrink-0', look[result])} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
