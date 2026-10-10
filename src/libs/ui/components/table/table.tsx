import type { ReactNode } from 'react'
import { cn } from 'cn'
import {
  Table as ShadcnTable,
  TableBody as ShadcnTableBody,
  TableCaption as ShadcnTableCaption,
  TableCell as ShadcnTableCell,
  TableHead as ShadcnTableHead,
  TableHeader as ShadcnTableHeader,
  TableRow as ShadcnTableRow,
} from '../../shadcn/table'

type CellAlign = 'start' | 'center' | 'end'

const alignClass: Record<CellAlign, string> = {
  start: 'text-left',
  center: 'text-center',
  end: 'text-right',
}

type TableProps = {
  /** Says what the table holds. Shown under it and read by screen readers. */
  caption?: ReactNode
  children: ReactNode
}

/** A data table. It scrolls sideways when it is wider than its container. */
export function Table({ caption, children }: TableProps) {
  return (
    <ShadcnTable>
      {caption !== undefined && <ShadcnTableCaption>{caption}</ShadcnTableCaption>}
      {children}
    </ShadcnTable>
  )
}

export function TableHeader({ children }: { children: ReactNode }) {
  return <ShadcnTableHeader>{children}</ShadcnTableHeader>
}

export function TableBody({ children }: { children: ReactNode }) {
  return <ShadcnTableBody>{children}</ShadcnTableBody>
}

export function TableRow({ children }: { children: ReactNode }) {
  return <ShadcnTableRow>{children}</ShadcnTableRow>
}

type TableHeadProps = {
  align?: CellAlign
  /** Use `row` for a header cell at the start of a body row. */
  scope?: 'col' | 'row'
  children?: ReactNode
}

export function TableHead({ align = 'start', scope = 'col', children }: TableHeadProps) {
  return (
    <ShadcnTableHead scope={scope} className={cn(alignClass[align])}>
      {children}
    </ShadcnTableHead>
  )
}

type TableCellProps = {
  align?: CellAlign
  children?: ReactNode
}

export function TableCell({ align = 'start', children }: TableCellProps) {
  return <ShadcnTableCell className={cn(alignClass[align])}>{children}</ShadcnTableCell>
}
