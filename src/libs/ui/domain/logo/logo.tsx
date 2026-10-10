import { cn } from 'cn'

type LogoProps = {
  size?: 'sm' | 'md'
  /** Shows the word "newt" next to the mark. */
  withName?: boolean
}

export function Logo({ size = 'md', withName = true }: LogoProps) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className={cn(size === 'sm' ? 'size-5' : 'size-7')} aria-hidden>
        <defs>
          <linearGradient id="newt-logo-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--brand-2)" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" className="fill-foreground/5 stroke-border" strokeWidth="1" />
        <path
          d="M9 23V12.5a3.5 3.5 0 0 1 7 0V23M16 12.5a3.5 3.5 0 0 1 7 0V23"
          fill="none"
          stroke="url(#newt-logo-gradient)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle cx="23" cy="9" r="2.2" fill="var(--brand)" />
      </svg>
      {withName && <span className="text-lg">newt</span>}
    </span>
  )
}
