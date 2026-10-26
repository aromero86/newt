import {
  Select as ShadcnSelect,
  SelectContent as ShadcnSelectContent,
  SelectItem as ShadcnSelectItem,
  SelectTrigger as ShadcnSelectTrigger,
  SelectValue as ShadcnSelectValue,
} from '../../shadcn/select'
import { useFieldControl } from '../field/context'

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

type SelectProps = {
  options: SelectOption[]
  value: string | undefined
  onValueChange: (value: string) => void
  /** Shown while nothing is selected. */
  placeholder?: string
  disabled?: boolean
  /** Marks the value as wrong. Inside a `Field`, its `error` does this. */
  invalid?: boolean
  /** Submitted with a form under this name. */
  name?: string
  /** Accessible name, for selects used outside a `Field`. */
  label?: string
  /** `compact`: as wide as its value and short, for filters in a toolbar or a box's header. */
  size?: 'full' | 'compact'
}

export function Select({ options, value, onValueChange, placeholder, disabled, invalid, name, label, size = 'full' }: SelectProps) {
  const field = useFieldControl()
  return (
    <ShadcnSelect value={value ?? ''} onValueChange={onValueChange} disabled={disabled} name={name}>
      <ShadcnSelectTrigger
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={invalid || field?.invalid || undefined}
        aria-label={label}
        size={size === 'compact' ? 'sm' : 'default'}
        className={size === 'compact' ? 'w-auto gap-1.5 bg-background text-sm' : 'w-full'}
      >
        <ShadcnSelectValue placeholder={placeholder} />
      </ShadcnSelectTrigger>
      <ShadcnSelectContent>
        {options.map(option => (
          <ShadcnSelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </ShadcnSelectItem>
        ))}
      </ShadcnSelectContent>
    </ShadcnSelect>
  )
}
