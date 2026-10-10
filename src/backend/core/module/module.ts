import { DomainError } from '../errors/domain-error'
import { ReferenceNotFound } from '../errors/reference-not-found'
import { TransactionManager } from '../unit-of-work/transaction-manager'

type Ref = { id: string, name: string }

/** A neighbour module whose rows can stand in as a named reference: city, brand… */
export interface RefFinder {
  find(criteria: { id: string[] }): Promise<Ref[]>
}

export abstract class Module {

    constructor(
      public readonly name: string,
      public readonly transactions: TransactionManager,
    ) {}

    /**
     * First row of a finder, or throws. The caller injects the error, so the
     * caller picks the status: 404 when the id IS the resource, 400 when it
     * is a reference inside a payload.
     */
    protected async resolve<T>(
      find: () => Promise<T[]>,
      onMissing: () => DomainError,
    ): Promise<T> {
      const [first] = await find()
      if (!first) throw onMissing()
      return first
    }

    /**
     * Turns a map of ids into a map of references, raising `ReferenceNotFound` (400)
     * for the first one that points nowhere.
     *
     * The three cases are the point of this helper:
     *   an id  → the reference it names
     *   `null` → `null`, meaning "no city"
     *   absent → absent from the result too, so a PATCH that never mentioned a
     *            reference leaves it exactly as it was
     */
    protected resolveRefs<K extends string>(
      ids: Record<K, string | null>,
      finders: Record<K, RefFinder>,
    ): Promise<Record<K, Ref | null>>
    protected resolveRefs<K extends string>(
      ids: Partial<Record<K, string | null | undefined>>,
      finders: Record<K, RefFinder>,
    ): Promise<Partial<Record<K, Ref | null>>>
    protected async resolveRefs<K extends string>(
      ids: Partial<Record<K, string | null | undefined>>,
      finders: Record<K, RefFinder>,
    ): Promise<Partial<Record<K, Ref | null>>> {
      const refs: Partial<Record<K, Ref | null>> = {}

      for (const key of Object.keys(ids) as K[]) {
        const id = ids[key]
        if (id === undefined) continue

        refs[key] = id === null
          ? null
          : await this.resolve(
              () => finders[key].find({ id: [id] }),
              () => new ReferenceNotFound(key, id),
            )
      }

      return refs
    }

}
