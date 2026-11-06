import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '../button'

type FileButtonProps = {
  /** The types a person is offered to choose from: `image/png`, `.pdf`… What is really sent is for the backend to check. */
  accept?: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  /** Shows a spinner and disables the button, while the file is on its way. */
  loading?: boolean
  /** The file someone chose. Choosing the same one again counts too. */
  onPick: (file: File) => void
  children: ReactNode
}

/** A button that asks for a file. */
export function FileButton({ accept, variant = 'outline', size = 'md', loading, onPick, children }: FileButtonProps) {
  const input = useRef<HTMLInputElement>(null)

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) onPick(file)
  }

  return (
    <>
      <input ref={input} type="file" hidden accept={accept} tabIndex={-1} aria-hidden onChange={onChange} />
      <Button variant={variant} size={size} loading={loading} onClick={() => input.current?.click()}>{children}</Button>
    </>
  )
}
