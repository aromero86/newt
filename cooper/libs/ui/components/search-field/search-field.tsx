import { useState, type FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { cn } from 'cn'

type SearchFieldProps = {
  /** Accessible name of the search. */
  label: string
  placeholder?: string
  /** What it starts with: a new value starts it again. */
  defaultValue?: string
  /** On Enter, with what was written, trimmed; never empty. */
  onSearch: (query: string) => void
  /** `md` to lead a page of results; `sm` in a header. */
  size?: 'sm' | 'md'
}

/** A box to search in, like the one at the top of a repository on GitHub. */
export function SearchField(props: SearchFieldProps) {
  return <SearchFieldInner key={props.defaultValue ?? ''} {...props} />
}

function SearchFieldInner({ label, placeholder, defaultValue = '', onSearch, size = 'md' }: SearchFieldProps) {
  const [value, setValue] = useState(defaultValue)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (value.trim()) onSearch(value.trim())
  }

  return (
    <form role="search" aria-label={label} onSubmit={onSubmit} className={cn('relative w-full', size === 'sm' && 'max-w-72')}>
      <SearchIcon aria-hidden className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', size === 'sm' ? 'left-2.5 size-3.5' : 'left-3 size-4')} />
      <input
        type="search"
        aria-label={label}
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border bg-background text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
          size === 'sm' ? 'h-8 pr-2 pl-8 text-xs' : 'h-10 pr-3 pl-9 text-sm',
        )}
      />
    </form>
  )
}
