import { Badge } from 'newt-react-ui/badge'
import type { ConnectionStatusDTO } from '../../api/connection'

const LOOKS = {
  up: { tone: 'ok', label: 'Up' },
  down: { tone: 'bad', label: 'Down' },
  unknown: { tone: 'muted', label: 'Not checked' },
} as const

/** Whether an application answers, as the monitor last found it. */
export function ConnectionBadge({ status }: { status: ConnectionStatusDTO['status'] }) {
  const look = LOOKS[status]
  return <Badge tone={look.tone}>{look.label}</Badge>
}
