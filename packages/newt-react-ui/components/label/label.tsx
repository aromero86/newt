import type { ReactNode } from 'react'
import { Label as ShadcnLabel } from '../../internal/label'

type LabelProps = {
  /** Id of the control this label names. */
  htmlFor: string
  children: ReactNode
}

export function Label({ htmlFor, children }: LabelProps) {
  return <ShadcnLabel htmlFor={htmlFor}>{children}</ShadcnLabel>
}
