import { useContext, useState } from 'react'
import { CartesianGrid, Line, LineChart as Lines, XAxis, YAxis } from 'recharts'
import { cn } from 'cn'
import { ChartContainer, ChartFillContext, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../internal/chart'
import { chartMarks, type ChartMark } from '../../internal/chart-marks'

export type { ChartMark } from '../../internal/chart-marks'

/** One line: its name, its tone, the axis it is read on, and a value (or none) at each time. */
export type LineSeries = {
  key: string
  label: string
  tone: 'brand' | 'ok' | 'warn' | 'bad' | 'muted'
  dashed?: boolean
  /** Read on the right axis, in its own unit (`formatRight`): a time beside counts. The left by default. */
  axis?: 'left' | 'right'
  /** One per time; null where there is none, and the line breaks. */
  values: (number | null)[]
}

type LineChartProps = {
  /** What it shows, for screen readers. */
  label: string
  /** The times of the values, ISO, one per point. */
  times: string[]
  series: LineSeries[]
  formatTime?: (at: string) => string
  /** How a value of the left axis reads, in the axis and the tooltip: `1,204`. */
  formatValue?: (value: number) => string
  /** How a value of the right axis reads: `120 ms`. */
  formatRight?: (value: number) => string
  /** Moments marked on its times, as dotted lines: a deployment, an instance that came or went. */
  marks?: readonly ChartMark[]
  height?: number
}

const TONES = { brand: 'var(--brand)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--muted-foreground)' } as const

/**
 * A few lines over the same times, each in a tone that says what it is: a latency's
 * percentiles, say, green to red. Where a line has no value it breaks. Its legend, below,
 * shows or hides each line as it is pressed; lines of another unit are read on a second
 * axis, at the right. shadcn's chart, on Recharts.
 */
export function LineChart({ label, times, series, formatTime = at => new Date(at).toLocaleString(), formatValue = value => value.toLocaleString('en'), formatRight = formatValue, marks = [], height = 220 }: LineChartProps) {
  const fill = useContext(ChartFillContext)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const config = Object.fromEntries(series.map(each => [each.key, { label: each.label, color: TONES[each.tone] }])) satisfies ChartConfig
  const data = times.map((at, index) => ({ at, ...Object.fromEntries(series.map(each => [each.key, each.values[index] ?? null])) }))
  const right = series.some(each => each.axis === 'right')
  const shownRight = series.some(each => each.axis === 'right' && !hidden.has(each.key))
  const axisOf = new Map(series.map(each => [each.key, each.axis ?? 'left']))
  const toggle = (key: string) => setHidden(current => {
    const next = new Set(current)
    if (!next.delete(key)) next.add(key)
    return next
  })

  return (
    <figure aria-label={label} className={cn('m-0', fill && 'flex h-full flex-col')}>
      <ChartContainer config={config} style={fill ? undefined : { height }} className={cn('w-full', fill && 'min-h-0 flex-1')}>
        <Lines data={data} margin={{ top: 8, right: right ? 0 : 8, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="at" tickLine={false} axisLine={false} tickMargin={8} minTickGap={48} tickFormatter={formatTime} />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} width={56} tickFormatter={formatValue} />
          {right && <YAxis yAxisId="right" orientation="right" hide={!shownRight} tickLine={false} axisLine={false} width={64} tickFormatter={formatRight} />}
          <ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltipContent marks={marks} labelFormatter={at => formatTime(String(at))} valueFormatter={(value, key) => (axisOf.get(key) === 'right' ? formatRight : formatValue)(value)} />} />
          {chartMarks(marks, 'left')}
          {series.map(each => (
            <Line
              key={each.key}
              dataKey={each.key}
              yAxisId={each.axis ?? 'left'}
              hide={hidden.has(each.key)}
              type="monotone"
              stroke={`var(--color-${each.key})`}
              strokeWidth={each.dashed ? 1.5 : 2}
              strokeDasharray={each.dashed ? '5 4' : undefined}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </Lines>
      </ChartContainer>
      {series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
          {series.map(each => (
            <button
              key={each.key}
              type="button"
              aria-pressed={!hidden.has(each.key)}
              onClick={() => toggle(each.key)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-sm focus-visible:outline-2 focus-visible:outline-brand ${hidden.has(each.key) ? 'text-muted-foreground line-through opacity-60' : 'text-foreground'}`}
            >
              <span aria-hidden className={`h-0.5 w-3 rounded-full ${each.dashed ? 'border-t border-dashed' : ''}`} style={{ background: each.dashed ? undefined : TONES[each.tone], borderColor: TONES[each.tone] }} />
              {each.label}{each.axis === 'right' ? ' (right)' : ''}
            </button>
          ))}
        </figcaption>
      )}
    </figure>
  )
}
