import { useState, type FormEvent } from 'react'
import { SearchIcon } from 'lucide-react'
import { cn } from 'cn'

type SearchFieldProps = {
  /** Accessible name of the search. */
  label: string
  placeholder?: string
  /** What it starts with: a new value starts it again. */
  defaultValue?: string
  /** On Enter, with what was written, trimmed; never empty. With `live`, as it is written, empty too. */
  onSearch: (query: string) => void
  /** A filter of what the page already shows: it filters as it is written, like GitHub's "Filter" boxes. */
  live?: boolean
  /** `md` to lead a page of results; `sm` in a header. */
  size?: 'sm' | 'md'
}

/** A box to search in, like the one at the top of a repository on GitHub. */
export function SearchField({ label, placeholder, defaultValue = '', onSearch, live = false, size = 'md' }: SearchFieldProps) {
  const [value, setValue] = useState(defaultValue)
  // A new value starts it again in place: the input stays mounted, so it keeps the focus after a search.
  const [previous, setPrevious] = useState(defaultValue)
  if (defaultValue !== previous) {
    setPrevious(defaultValue)
    setValue(defaultValue)
  }

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
        onChange={event => {
          setValue(event.target.value)
          if (live) onSearch(event.target.value.trim())
        }}
        placeholder={placeholder}
        className={cn(
          'w-full rounded-md border bg-background text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
          size === 'sm' ? 'h-8 pr-2 pl-8 text-xs' : 'h-10 pr-3 pl-9 text-sm',
        )}
      />
    </form>
  )
}
