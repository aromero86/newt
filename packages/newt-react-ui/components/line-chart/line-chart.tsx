import { CartesianGrid, Line, LineChart as Lines, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../internal/chart'

/** One line: its name, its tone, and a value (or none) at each time. */
export type LineSeries = {
  key: string
  label: string
  tone: 'brand' | 'ok' | 'warn' | 'bad' | 'muted'
  dashed?: boolean
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
  /** How a value reads, in the axis and the tooltip: `120 ms`. */
  formatValue?: (value: number) => string
  height?: number
}

const TONES = { brand: 'var(--brand)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--muted-foreground)' } as const

/**
 * A few lines over the same times, each in a tone that says what it is: a latency's
 * percentiles, say, green to red. Where a line has no value it breaks. shadcn's chart,
 * on Recharts.
 */
export function LineChart({ label, times, series, formatTime = at => new Date(at).toLocaleString(), formatValue = value => value.toLocaleString('en'), height = 220 }: LineChartProps) {
  const config = Object.fromEntries(series.map(each => [each.key, { label: each.label, color: TONES[each.tone] }])) satisfies ChartConfig
  const data = times.map((at, index) => ({ at, ...Object.fromEntries(series.map(each => [each.key, each.values[index] ?? null])) }))

  return (
    <figure aria-label={label} className="m-0">
      <ChartContainer config={config} style={{ height }} className="w-full">
        <Lines data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="at" tickLine={false} axisLine={false} tickMargin={8} minTickGap={48} tickFormatter={formatTime} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={formatValue} />
          <ChartTooltip cursor={{ strokeDasharray: '3 3' }} content={<ChartTooltipContent labelFormatter={at => formatTime(String(at))} valueFormatter={formatValue} />} />
          {series.map(each => (
            <Line
              key={each.key}
              dataKey={each.key}
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
    </figure>
  )
}
