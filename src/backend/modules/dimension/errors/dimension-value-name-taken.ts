import { ConflictError } from '../../../core/errors/conflict-error'

/** Also when the value with that name is retired: it is restored, not repeated. */
export class DimensionValueNameTaken extends ConflictError {
  readonly code = 'dimension.value_name_taken'
  constructor(name: string, retired: boolean) {
    super(retired ? `${name} is a retired value of this dimension: restore it instead` : `This dimension already has a value called ${name}`)
  }
}
