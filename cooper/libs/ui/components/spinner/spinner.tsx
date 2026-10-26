import { cn } from 'cn'
import { Spinner as ShadcnSpinner } from '../../shadcn/spinner'

type Size = 'sm' | 'md'

const sizeClass: Record<Size, string> = {
  sm: 'size-4',
  md: 'size-6',
}

type SpinnerProps = {
  /** What is loading, read out by screen readers. */
  label?: string
  size?: Size
}

/** A loading indicator that screen readers announce as a status. */
export function Spinner({ label = 'Loading', size = 'md' }: SpinnerProps) {
  return <ShadcnSpinner aria-label={label} className={cn(sizeClass[size])} />
}
