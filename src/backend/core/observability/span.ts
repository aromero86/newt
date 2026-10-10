export interface Span {
  setError(error: unknown): void
  end(): void
}
