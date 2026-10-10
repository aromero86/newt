export interface TransactionRunner {
  exec(sql: string): void
}
