import { useEffect, useState } from 'react'
import { useService } from '@newt-kit/react'
import { EventMetricsApi, type EventTotalDTO } from '../../../api/event-metrics'
import { UseCaseErrorsApi, type ErrorsTotalDTO } from '../../../api/use-case-errors'
import { UseCaseMetricsApi, type UseCaseTotalDTO } from '../../../api/use-case-metrics'
import { formatMs } from './metrics-format'

/** Each use case's calls in the last 24 hours, by `<context>|<use case>`: null until known. */
export function useUseCaseTotals(appId: string): Map<string, UseCaseTotalDTO> | null {
  const api = useService(UseCaseMetricsApi)
  const [totals, setTotals] = useState<Map<string, UseCaseTotalDTO> | null>(null)
  useEffect(() => {
    api.totals(appId, '24h')
      .then(found => setTotals(new Map(found.map(total => [`${total.context}|${total.useCase}`, total]))))
      .catch(() => setTotals(new Map()))
  }, [api, appId])
  return totals
}

/** Each use case's errors and failures in the last 24 hours, by `<context>|<use case>`: null until known. */
export function useUseCaseEnded(appId: string): Map<string, ErrorsTotalDTO> | null {
  const api = useService(UseCaseErrorsApi)
  const [ended, setEnded] = useState<Map<string, ErrorsTotalDTO> | null>(null)
  useEffect(() => {
    api.totals(appId, '24h')
      .then(found => setEnded(new Map(found.map(total => [`${total.context}|${total.useCase}`, total]))))
      .catch(() => setEnded(new Map()))
  }, [api, appId])
  return ended
}

/** Each event's total in the last 24 hours, beside the 24 before, by `<context>|<event>`: null until known. */
export function useEventTotals(appId: string): Map<string, EventTotalDTO> | null {
  const api = useService(EventMetricsApi)
  const [totals, setTotals] = useState<Map<string, EventTotalDTO> | null>(null)
  useEffect(() => {
    api.totals(appId, '24h')
      .then(found => setTotals(new Map(found.map(total => [`${total.context}|${total.event}`, total]))))
      .catch(() => setTotals(new Map()))
  }, [api, appId])
  return totals
}

/** `340 calls in 24h, 12 retries, p90 45 ms`. */
export function describeUseCaseTotal(total: UseCaseTotalDTO | undefined): string {
  if (!total || total.now.calls === 0) return 'not called in 24h'
  const retries = total.now.retries ? `, ${total.now.retries.toLocaleString('en')} ${total.now.retries === 1 ? 'retry' : 'retries'}` : ''
  return `${total.now.calls.toLocaleString('en')} calls in 24h${retries}, p90 ${formatMs(total.now.p90)}`
}

/** `3 failures, 12 errors`: null when none ended badly. */
export function describeEnded(ended: ErrorsTotalDTO | undefined): string | null {
  if (!ended) return null
  const parts = [
    ended.now.failures ? `${ended.now.failures.toLocaleString('en')} ${ended.now.failures === 1 ? 'failure' : 'failures'}` : '',
    ended.now.errors ? `${ended.now.errors.toLocaleString('en')} ${ended.now.errors === 1 ? 'error' : 'errors'}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/** `128 in 24h, +12% from the day before`. */
export function describeEventTotal(total: EventTotalDTO | undefined): string {
  if (!total || (total.total === 0 && total.previous === 0)) return 'not told in 24h'
  const change = total.previous === 0 ? null : Math.round(((total.total - total.previous) / total.previous) * 100)
  return `${total.total.toLocaleString('en')} in 24h${change === null ? '' : `, ${change > 0 ? '+' : ''}${change}% from the day before`}`
}
