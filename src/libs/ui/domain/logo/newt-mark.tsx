import { cn } from 'cn'

/** The small "n" that signs what newt writes somewhere else, like a comment on GitHub. */
export function NewtMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[5px] bg-linear-to-br from-brand to-brand-2 font-bold text-background',
        size === 'sm' ? 'size-3.5 text-[8px]' : 'size-4 text-[9px]',
      )}
    >
      n
    </span>
  )
}
