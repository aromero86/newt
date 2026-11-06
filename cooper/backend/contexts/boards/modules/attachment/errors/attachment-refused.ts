import { ValidationError } from '@newt-kit/newt/core'
import type { UploadRefusal } from '@newt-kit/newt/port-storage'

const WHY: Record<UploadRefusal, string> = {
  missing: 'The file never arrived',
  too_large: 'The file is too long',
  wrong_type: 'The file is not what it says it is',
}

export class AttachmentRefused extends ValidationError {
  readonly code = 'attachment.refused'
  constructor(refusal: UploadRefusal) {
    super(WHY[refusal])
  }
}
