import type { ReactNode } from 'react'

/** The title of a page about one thing, with its reference beside it: "Pay in three installments PROP-3". */
export function PageTitle({ children, reference }: { children: ReactNode, reference?: ReactNode }) {
  return (
    <h1 className="text-2xl font-semibold tracking-tight break-words">
      {children}
      {reference !== undefined && <span className="ml-2 font-mono text-xl font-normal text-muted-foreground">{reference}</span>}
    </h1>
  )
}
