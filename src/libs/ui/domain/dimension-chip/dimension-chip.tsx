import { cn } from 'cn'

type DimensionChipProps = {
  name: string
  value: string
  /** Highlights the chip, e.g. when it is the current filter. */
  active?: boolean
}

/** A dimension value, e.g. `surface: Mobile app`. */
export function DimensionChip({ name, value, active = false }: DimensionChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap transition-colors',
        active ? 'border-brand/50 bg-brand/15 text-foreground' : 'bg-background/60 text-muted-foreground',
      )}
    >
      <span className="opacity-60">{name}:</span> {value}
    </span>
  )
}
