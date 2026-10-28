import { useContext } from 'react'
import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from 'recharts'
import { cn } from 'cn'
import { ChartContainer, ChartFillContext, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../internal/chart'

/** A point of a series: when its bucket starts, and how many. */
export type TimePoint = { at: string, count: number }

type TimeSeriesProps = {
  /** What it shows, for screen readers. */
  label: string
  points: TimePoint[]
  /** The series it is compared with, drawn at the same times: dashed and muted. */
  compared?: TimePoint[] | null
  /** What each series is called in the tooltip: `Last 24 hours`, `The day before`. */
  names?: { points: string, compared?: string }
  /** How a bucket's time reads, in the axis and the tooltip. */
  formatTime?: (at: string) => string
  height?: number
}

/**
 * A series over time, beside the one it is compared with: GitHub's insights style, the
 * brand's colour for now, a muted dash for before. Hovering shows a bucket's values. It
 * takes the width it is given. shadcn's chart, on Recharts.
 */
export function TimeSeries({ label, points, compared, names = { points: 'Now', compared: 'Before' }, formatTime = at => new Date(at).toLocaleString(), height = 220 }: TimeSeriesProps) {
  const fill = useContext(ChartFillContext)
  const config = {
    now: { label: names.points, color: 'var(--brand)' },
    before: { label: names.compared ?? 'Before', color: 'var(--muted-foreground)' },
  } satisfies ChartConfig
  const data = points.map((point, index) => ({ at: point.at, now: point.count, ...(compared?.[index] ? { before: compared[index]!.count } : {}) }))

  return (
    <figure aria-label={label} className={cn('m-0', fill && 'flex h-full flex-col')}>
      <ChartContainer config={config} style={fill ? undefined : { height }} className={cn('w-full', fill && 'min-h-0 flex-1')}>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id="time-series-now" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-now)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-now)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="at" tickLine={false} axisLine={false} tickMargin={8} minTickGap={48} tickFormatter={formatTime} />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltipContent labelFormatter={at => formatTime(String(at))} />} />
          {compared && compared.length > 0 && (
            <Line dataKey="before" type="monotone" stroke="var(--color-before)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          )}
          <Area dataKey="now" type="monotone" stroke="var(--color-now)" strokeWidth={2} fill="url(#time-series-now)" dot={false} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </figure>
  )
}
