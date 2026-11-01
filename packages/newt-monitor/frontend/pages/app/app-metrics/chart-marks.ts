import { useValue, useService } from '@newt-kit/react'
import type { ChartMark } from '@newt-kit/react-ui/line-chart'
import { AppService, type AppMark } from '../app.service'

/**
 * The marks that fall within a chart's times, each on the bucket it fell in: the
 * buckets are as long as the gap between its first two times.
 */
export function marksOn(times: readonly string[], marks: readonly AppMark[]): ChartMark[] {
  if (times.length < 2) return []
  const starts = times.map(at => Date.parse(at))
  const size = starts[1]! - starts[0]!
  return marks.flatMap(mark => {
    const at = Date.parse(mark.at)
    if (at < starts[0]! || at >= starts.at(-1)! + size) return []
    const index = Math.min(starts.length - 1, Math.floor((at - starts[0]!) / size))
    return [{ at: times[index]!, label: `${mark.label}, ${new Date(at).toLocaleString()}`, detail: mark.detail, tone: mark.tone }]
  })
}

/** The application's marks, for its charts to place with `marksOn`: its deployments, its instances' comings and goings. */
export function useAppMarks(): readonly AppMark[] {
  return useValue(useService(AppService).marks)
}
