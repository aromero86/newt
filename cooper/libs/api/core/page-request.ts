import type { PageRequest as ContractPageRequest } from 'newt/contract'

/**
 * Which page of a list: newt's `PageRequest`, up to `size` items after `cursor`, with
 * `size` left out when the backend's own will do.
 */
export type PageRequest = Omit<ContractPageRequest, 'size'> & { size?: number }
