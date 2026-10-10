import type { ReactNode } from 'react'
import { cn } from 'cn'

// Inline marks for words inside a sentence. They let a text say "this part
// stands out" without the text styling anything.

/** Words that matter, in the foreground colour, inside muted text. */
export function Emphasis({ children }: { children: ReactNode }) {
  return <span className="text-foreground">{children}</span>
}

/** Like `Emphasis`, and bold. */
export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>
}

/** Code-ish words: a file, a parameter, an id. */
export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono">{children}</span>
}

type Tone = 'ok' | 'warn' | 'bad'

const toneClass: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
}

/** Words in a state colour. */
export function Tone({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn(toneClass[tone])}>{children}</span>
}
