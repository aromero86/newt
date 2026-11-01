import { Badge } from '@newt-kit/react-ui/badge'
import type { ConnectionStatusDTO } from '../../api/connection'

const LOOKS = {
  up: { tone: 'ok', label: 'Up' },
  down: { tone: 'bad', label: 'Down' },
  unknown: { tone: 'muted', label: 'Not checked' },
} as const

/** Whether an application answers, as the monitor last found it; with `href`, a link to where it is told in full. */
export function ConnectionBadge({ status, href }: { status: ConnectionStatusDTO['status'], href?: string }) {
  const look = LOOKS[status]
  return <Badge tone={look.tone} href={href} label={href ? `Connection: ${look.label}. See its details` : undefined}>{look.label}</Badge>
}
