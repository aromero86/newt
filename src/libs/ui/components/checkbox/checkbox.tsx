import { Checkbox as ShadcnCheckbox } from '../../shadcn/checkbox'

type CheckboxProps = {
  checked: boolean
  /** Accessible name. */
  label: string
  onCheckedChange?: (checked: boolean) => void
  /** Shows the state without letting anyone change it. */
  readOnly?: boolean
}

export function Checkbox({ checked, label, onCheckedChange, readOnly = false }: CheckboxProps) {
  return (
    <ShadcnCheckbox
      checked={checked}
      aria-label={label}
      aria-readonly={readOnly || undefined}
      className={readOnly ? 'pointer-events-none' : undefined}
      onCheckedChange={readOnly ? undefined : state => onCheckedChange?.(state === true)}
    />
  )
}
