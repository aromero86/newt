import { MemoryStorage } from '../memory-storage'
import { describeStorageContract } from './describe-storage-contract'

describeStorageContract('MemoryStorage', {
  open: async () => new MemoryStorage(),
  send: (storage, address, init) => storage.send(address, init),
})
