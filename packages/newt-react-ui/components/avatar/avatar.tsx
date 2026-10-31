import { cn } from 'cn'
import { Avatar as ShadcnAvatar, AvatarFallback } from '../../internal/avatar'

type Size = 3.5 | 4 | 5 | 6 | 7 | 8 | 9

const sizeClass: Record<Size, { box: string; letter: string }> = {
  3.5: { box: 'size-3.5', letter: 'text-[7px]' },
  4: { box: 'size-4', letter: 'text-[8px]' },
  5: { box: 'size-5', letter: 'text-[9px]' },
  6: { box: 'size-6', letter: 'text-[10px]' },
  7: { box: 'size-7', letter: 'text-[11px]' },
  8: { box: 'size-8', letter: 'text-xs' },
  9: { box: 'size-9', letter: 'text-sm' },
}

const tones = ['bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500']

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

/** The name's first character as a reader sees it: a whole emoji, not half of one, and never a leading space. */
function initial(name: string) {
  const trimmed = name.trim()
  const first = graphemes ? graphemes.segment(trimmed)[Symbol.iterator]().next().value?.segment : [...trimmed][0]
  return (first ?? '').toUpperCase()
}

type AvatarProps = {
  name: string
  /** Width and height, in Tailwind's spacing scale. */
  size?: Size
}

/** A person's initial on a colour that always comes out the same for the same name. */
export function Avatar({ name, size = 6 }: AvatarProps) {
  const tone = tones[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tones.length]
  return (
    <ShadcnAvatar aria-hidden className={sizeClass[size].box}>
      {/* The letter's size goes on the fallback: shadcn sets its own text size there. */}
      <AvatarFallback className={cn('font-semibold text-white', sizeClass[size].letter, tone)}>{initial(name)}</AvatarFallback>
    </ShadcnAvatar>
  )
}
