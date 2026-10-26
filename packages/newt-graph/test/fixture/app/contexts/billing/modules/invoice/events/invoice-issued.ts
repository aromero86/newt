import { now, type DomainEvent } from 'newt/core'

export type InvoiceIssue = { orderId: string, total: number }

export class Invoice_Issued implements DomainEvent<InvoiceIssue> {
  static readonly eventName = 'invoice.issued'
  readonly name = Invoice_Issued.eventName
  readonly occurredAt = now().toISOString()
  constructor(readonly payload: InvoiceIssue) {}
}
