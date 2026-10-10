import { useEffect } from 'react'
import { Badge } from '@newt/ui/components/badge'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { HealthService } from '../../services/health/health.service'

const look = {
  checking: { tone: 'muted', text: 'Checking the API…' },
  up: { tone: 'ok', text: 'API online' },
  down: { tone: 'bad', text: 'API offline' },
} as const

/** Whether the backend answers: the one piece of the API there is so far. */
export function HomeApiStatus() {
  const service = useService(HealthService)
  const health = useValue(service.health)

  useEffect(() => {
    void service.check()
  }, [service])

  return <Badge tone={look[health].tone}>{look[health].text}</Badge>
}
