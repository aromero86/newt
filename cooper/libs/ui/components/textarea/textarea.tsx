import { Textarea as ShadcnTextarea } from '../../shadcn/textarea'
import { useFieldControl } from '../field/context'

type TextareaProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** Marks the value as wrong. Inside a `Field`, its `error` does this. */
  invalid?: boolean
  name?: string
  autoComplete?: string
  /** Minimum visible lines. */
  rows?: number
  /** Accessible name, for textareas used outside a `Field`. */
  label?: string
}

export function Textarea({ value, onChange, placeholder, disabled, invalid, name, autoComplete, rows, label }: TextareaProps) {
  const field = useFieldControl()
  return (
    <ShadcnTextarea
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={invalid || field?.invalid || undefined}
      aria-label={label}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      name={name}
      autoComplete={autoComplete}
      rows={rows}
    />
  )
}
