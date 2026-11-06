import { PrivateFiles, PublicFiles, type ContextStorage, type StorageOptions } from '../../port-storage'
import { tracedStorage } from '../traces/traced-storage'

/**
 * What a context's modules reach of its files, each kind under the context's name, so
 * contexts sharing a bucket never meet. A kind it was not given is an error only once a
 * module asks for it: never a silent place in memory, where files would be lost.
 */
export function contextStorage(options: StorageOptions | undefined, context: string): ContextStorage {
  const missing = (kind: string) => new Error(`The context '${context}' was given no ${kind} storage: BaseOptions.storage.${kind}`)
  const adapters = {
    private: options?.private && tracedStorage(options.private, context),
    public: options?.public && tracedStorage(options.public, context),
  }
  return {
    get private() {
      if (!adapters.private) throw missing('private')
      return new PrivateFiles(adapters.private, context)
    },
    get public() {
      if (!adapters.public) throw missing('public')
      return new PublicFiles(adapters.public, context)
    },
  }
}
