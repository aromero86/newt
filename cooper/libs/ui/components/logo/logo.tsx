import { cn } from 'cn'

type LogoProps = {
  /** The words after the mark: "Cooper", "Cooper Backoffice". */
  name?: string
  size?: 'sm' | 'md'
}

/** cooper's mark, three columns of a board, and the app's name beside it. */
export function Logo({ name = 'Cooper', size = 'md' }: LogoProps) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-foreground">
      <svg viewBox="0 0 24 24" className={cn('shrink-0', size === 'sm' ? 'size-5' : 'size-7')} aria-hidden>
        <rect x="1" y="1" width="22" height="22" rx="5" className="fill-foreground" />
        <rect x="5" y="5" width="3.5" height="12" rx="1" className="fill-background" />
        <rect x="10.25" y="5" width="3.5" height="8" rx="1" className="fill-background" />
        <rect x="15.5" y="5" width="3.5" height="14" rx="1" className="fill-background" />
      </svg>
      <span className={cn(size === 'sm' ? 'text-sm' : 'text-lg')}>{name}</span>
    </span>
  )
}
