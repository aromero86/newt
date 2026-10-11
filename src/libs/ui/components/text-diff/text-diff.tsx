import { cn } from 'cn'

/** A run of lines: kept, added or removed. */
export type TextDiffPart = { value: string, added?: boolean, removed?: boolean }

const look = {
  added: 'bg-ok/12 text-ok',
  removed: 'bg-bad/12 text-bad line-through decoration-bad/40',
  same: 'text-muted-foreground',
}

/** Two versions of a text, line by line: what was added and what was removed. */
export function TextDiff({ parts, label }: { parts: TextDiffPart[], label: string }) {
  if (parts.length === 0) return null
  return (
    <pre aria-label={label} className="overflow-x-auto rounded-md border bg-background/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
      {parts.map((part, index) => {
        const kind = part.added ? 'added' : part.removed ? 'removed' : 'same'
        const lines = part.value.replace(/\n$/, '').split('\n')
        return lines.map((line, at) => (
          <div key={`${index}-${at}`} className={cn('px-1', look[kind])}>
            <span aria-hidden className="mr-2 select-none opacity-60">{kind === 'added' ? '+' : kind === 'removed' ? '−' : ' '}</span>
            {kind === 'added' && <span className="sr-only">Added: </span>}
            {kind === 'removed' && <span className="sr-only">Removed: </span>}
            {line || ' '}
          </div>
        ))
      })}
    </pre>
  )
}
