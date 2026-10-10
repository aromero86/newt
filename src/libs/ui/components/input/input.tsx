import { Input as ShadcnInput } from '../../shadcn/input'
import { useFieldControl } from '../field/context'

type InputProps = {
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password' | 'search' | 'number'
  placeholder?: string
  disabled?: boolean
  /** Marks the value as wrong. Inside a `Field`, its `error` does this. */
  invalid?: boolean
  name?: string
  autoComplete?: string
  /** Accessible name, for inputs used outside a `Field`. */
  label?: string
}

export function Input({ value, onChange, type = 'text', placeholder, disabled, invalid, name, autoComplete, label }: InputProps) {
  const field = useFieldControl()
  return (
    <ShadcnInput
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={invalid || field?.invalid || undefined}
      aria-label={label}
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      name={name}
      autoComplete={autoComplete}
    />
  )
}
