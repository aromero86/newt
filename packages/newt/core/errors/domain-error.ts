export abstract class DomainError extends Error {
  abstract readonly status: number
  abstract readonly code: string

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}
