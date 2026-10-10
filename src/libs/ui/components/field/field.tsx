import { type ReactNode, useId, useMemo } from 'react'
import { Label } from '../label'
import { FieldContext } from './context'

type FieldProps = {
  label: ReactNode
  /** Help text under the control. */
  description?: ReactNode
  /** When set, the control is marked invalid and this message is read with it. */
  error?: ReactNode
  /** One control from @newt/ui: `Input`, `Textarea` or `Select`. */
  children: ReactNode
}

/** A labelled form control with optional help text and error message. */
export function Field({ label, description, error, children }: FieldProps) {
  const id = useId()
  const controlId = `${id}-control`
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const hasDescription = description !== undefined && description !== null
  const hasError = error !== undefined && error !== null && error !== false

  const describedBy = [hasDescription && descriptionId, hasError && errorId].filter(Boolean).join(' ') || undefined
  const control = useMemo(() => ({ id: controlId, describedBy, invalid: hasError }), [controlId, describedBy, hasError])

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={controlId}>{label}</Label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {hasDescription && (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
