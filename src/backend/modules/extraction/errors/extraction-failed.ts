import { DomainError } from '../../../core/errors/domain-error'

export class ExtractionFailed extends DomainError {
  readonly status = 502
  readonly code = 'extraction.failed'
  constructor(reason: string) {
    super(`The deltas could not be extracted from the document: ${reason}`)
  }
}
