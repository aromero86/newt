import { ReferenceLine } from 'recharts'

/** A moment marked on a chart's times: a deployment, an instance that came or went. */
export type ChartMark = {
  /** One of the chart's times: the bucket it fell in. */
  at: string
  /** What happened, shown as the mark is hovered. */
  label: string
  tone?: 'brand' | 'ok' | 'warn' | 'bad' | 'muted'
}

const TONES = { brand: 'var(--brand)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', muted: 'var(--muted-foreground)' } as const

/** A small flag at the top of a mark, which tells what it is as it is hovered. */
function Flag({ viewBox, label, color }: { viewBox?: { x?: number, y?: number }, label: string, color: string }) {
  const x = viewBox?.x ?? 0
  const y = viewBox?.y ?? 0
  return (
    <g>
      <title>{label}</title>
      <path d={`M${x - 4},${y} L${x + 4},${y} L${x},${y + 6} Z`} fill={color} />
    </g>
  )
}

/**
 * Each mark as a dotted vertical line with a flag: called inside a Recharts chart, as
 * its children (not a component of its own, which Recharts would not see). Marks on
 * the same time are one, their labels joined.
 */
export function chartMarks(marks: readonly ChartMark[], yAxisId?: string) {
  const byTime = new Map<string, ChartMark[]>()
  for (const mark of marks) byTime.set(mark.at, [...byTime.get(mark.at) ?? [], mark])
  return [...byTime].map(([at, same]) => {
    const color = TONES[same[0]!.tone ?? 'muted']
    return (
      <ReferenceLine
        key={at}
        x={at}
        yAxisId={yAxisId}
        stroke={color}
        strokeDasharray="2 3"
        strokeOpacity={0.8}
        ifOverflow="hidden"
        label={<Flag label={same.map(mark => mark.label).join('\n')} color={color} />}
      />
    )
  })
}
