import { describeCardSearchContract } from './card-search.contract'
import { MemoryCardSearch } from './memory-card-search'

describeCardSearchContract('MemoryCardSearch', () => new MemoryCardSearch())
