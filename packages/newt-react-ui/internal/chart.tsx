import { createContext, useContext, useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import * as Recharts from 'recharts'
import { cn } from 'cn'
import { MARK_TONES, type ChartMark } from './chart-marks'

// shadcn/ui's chart: Recharts, coloured by the theme's tokens. Each series of a chart
// has a key in its config, with a label and a colour; the container sets it as
// `--color-<key>`, and the chart draws with `var(--color-<key>)`.

export type ChartConfig = Record<string, { label?: ReactNode, color?: string }>

const ChartContext = createContext<{ config: ChartConfig } | null>(null)

/** True inside a zoom: a chart fills the height it is given there, instead of its own. */
export const ChartFillContext = createContext(false)

function useChart() {
  const context = useContext(ChartContext)
  if (!context) throw new Error('useChart must be used within a <ChartContainer />')
  return context
}

export function ChartContainer({ id, className, children, config, style, ...props }: ComponentProps<'div'> & {
  config: ChartConfig
  children: ComponentProps<typeof Recharts.ResponsiveContainer>['children']
}) {
  const unique = useId()
  const chartId = `chart-${id ?? unique.replace(/:/g, '')}`
  const colors = Object.fromEntries(Object.entries(config).filter(([, each]) => each.color).map(([key, each]) => [`--color-${key}`, each.color])) as CSSProperties

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        style={{ ...colors, ...style }}
        className={cn(
          'flex aspect-auto justify-center text-xs',
          '[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-layer]:outline-hidden [&_.recharts-surface]:outline-hidden',
          className,
        )}
        {...props}
      >
        <Recharts.ResponsiveContainer>{children}</Recharts.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = Recharts.Tooltip

type TooltipItem = { dataKey?: string | number, name?: string | number, value?: number | string, color?: string, payload?: Record<string, unknown> }

/** The tooltip's box: the label, each series' colour, name and value, and what was marked then. */
export function ChartTooltipContent({ active, payload, label, labelFormatter, valueFormatter, marks = [] }: {
  active?: boolean
  payload?: TooltipItem[]
  label?: unknown
  labelFormatter?: (label: unknown) => ReactNode
  valueFormatter?: (value: number, key: string) => ReactNode
  marks?: readonly ChartMark[]
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null
  const marked = marks.filter(mark => mark.at === label)

  return (
    <div className="grid max-w-96 min-w-32 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium text-foreground">{labelFormatter ? labelFormatter(label) : String(label ?? '')}</div>
      <div className="grid gap-1">
        {payload.map(item => {
          const key = String(item.dataKey ?? item.name ?? 'value')
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: `var(--color-${key})` }} />
              <span className="text-muted-foreground">{config[key]?.label ?? key}</span>
              <span className="ml-auto font-mono font-medium text-foreground tabular-nums">
                {typeof item.value === 'number' ? (valueFormatter ? valueFormatter(item.value, key) : item.value.toLocaleString('en')) : item.value}
              </span>
            </div>
          )
        })}
      </div>
      {marked.length > 0 && (
        <div className="grid gap-2 border-t pt-1.5">
          {marked.map((mark, index) => (
            <div key={index} className="grid gap-0.5 border-l-2 pl-2" style={{ borderColor: MARK_TONES[mark.tone ?? 'muted'] }}>
              <span className="font-medium text-foreground">{mark.label}</span>
              {mark.detail && <span className="line-clamp-6 whitespace-pre-line text-muted-foreground">{mark.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
