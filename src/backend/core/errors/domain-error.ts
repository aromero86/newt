export interface DomainErrorOptions {
  commitOnThrow?: boolean
}

export abstract class DomainError extends Error {
  abstract readonly status: number
  abstract readonly code: string

  readonly commitOnThrow: boolean

  constructor(message: string, options?: DomainErrorOptions) {
    super(message)
    this.name = new.target.name
    this.commitOnThrow = options?.commitOnThrow ?? false
  }
}
