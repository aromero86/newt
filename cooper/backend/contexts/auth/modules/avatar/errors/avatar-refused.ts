import { ValidationError } from '@newt-kit/newt/core'
import type { UploadRefusal } from '@newt-kit/newt/port-storage'

const WHY: Record<UploadRefusal, string> = {
  missing: 'The image never arrived',
  too_large: 'The image is too long',
  wrong_type: 'The file is not the image it says it is',
}

export class AvatarRefused extends ValidationError {
  readonly code = 'avatar.refused'
  constructor(refusal: UploadRefusal) {
    super(WHY[refusal])
  }
}
