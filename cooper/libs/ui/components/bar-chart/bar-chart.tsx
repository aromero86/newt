import { cn } from 'cn'

export type BarChartDatum = {
  /** What the bar is: a day, a month. */
  label: string
  value: number
}

type BarChartProps = {
  /** What it shows, read by screen readers and as the table's caption: "Cards created per day". */
  label: string
  data: BarChartDatum[]
  /** How a value reads in its tooltip and table: `3 cards`. */
  formatValue?: (value: number) => string
}

/**
 * A small chart of one series in bars, over time or any order: one hue, bars from a
 * shared baseline, the highest value on the scale and the first and last labels under
 * it. Each bar tells its label and value on hover or focus, and a table says it all
 * for screen readers.
 */
export function BarChart({ label, data, formatValue = value => value.toLocaleString('en') }: BarChartProps) {
  const max = Math.max(0, ...data.map(datum => datum.value))

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div aria-hidden className="flex gap-2">
        <div className="flex w-6 shrink-0 flex-col justify-between text-right text-[11px] text-muted-foreground tabular-nums">
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="relative flex h-32 min-w-0 flex-1 items-end gap-0.5 border-b border-border">
          {/* The top of the scale: a faint line, behind the bars. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70" />
          {data.map(datum => (
            <div key={datum.label} tabIndex={0} className="group relative flex h-full min-w-0 flex-1 items-end rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <div
                className={cn('w-full rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80', datum.value === 0 && 'opacity-0')}
                style={{ height: max === 0 ? 0 : `${(datum.value / max) * 100}%` }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-hover:block group-focus-visible:block">
                <span className="text-muted-foreground">{datum.label}</span> <span className="font-medium tabular-nums">{formatValue(datum.value)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      {data.length > 0 && (
        <div aria-hidden className="ml-8 flex justify-between text-[11px] text-muted-foreground">
          <span>{data[0]!.label}</span>
          <span>{data.at(-1)!.label}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map(datum => (
            <tr key={datum.label}>
              <th scope="row">{datum.label}</th>
              <td>{formatValue(datum.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
