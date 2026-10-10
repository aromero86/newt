import { cn } from 'cn'
import { Skeleton as ShadcnSkeleton } from '../../shadcn/skeleton'

type Height = 'sm' | 'md' | 'lg' | 'xl'

const heightClass: Record<Height, string> = {
  sm: 'h-4',
  md: 'h-8',
  lg: 'h-24',
  xl: 'h-48',
}

type Width = 'full' | 'half' | 'third'

const widthClass: Record<Width, string> = {
  full: 'w-full',
  half: 'w-1/2',
  third: 'w-1/3',
}

type SkeletonProps =
  /** Lines of text; the last one is shorter. */
  | { lines: number; height?: never; width?: never }
  /** One block. */
  | { lines?: never; height?: Height; width?: Width }

const pulse = 'motion-reduce:animate-none'

/**
 * A placeholder for content that is loading. It is hidden from screen readers:
 * say that something is loading elsewhere, for example with a `Spinner`.
 */
export function Skeleton(props: SkeletonProps) {
  if (props.lines !== undefined) {
    const count = Math.max(1, Math.floor(props.lines))
    return (
      <div aria-hidden className="flex w-full flex-col gap-2">
        {Array.from({ length: count }, (_, index) => (
          <ShadcnSkeleton key={index} className={cn(pulse, 'h-4', index === count - 1 && count > 1 ? 'w-2/3' : 'w-full')} />
        ))}
      </div>
    )
  }
  const { height = 'md', width = 'full' } = props
  return <ShadcnSkeleton aria-hidden className={cn(pulse, heightClass[height], widthClass[width])} />
}
