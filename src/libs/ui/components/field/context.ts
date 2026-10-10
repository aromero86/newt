import { createContext, useContext } from 'react'

/** What a `Field` hands to the control inside it. */
export type FieldControl = {
  id: string
  /** Ids of the description and the error, when they are shown. */
  describedBy: string | undefined
  invalid: boolean
}

export const FieldContext = createContext<FieldControl | null>(null)

/** The ids a control needs to be tied to its `Field`, or `null` outside one. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldContext)
}
