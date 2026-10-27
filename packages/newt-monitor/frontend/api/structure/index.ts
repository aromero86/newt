// The contract comes from the backend module; the client is ours.
export type { RefreshDTO, StructureVersionDTO, StructureVersionSummaryDTO } from '../../../src/contexts/monitor/modules/structure/structure.schema'
export type { ApplicationDescription, ContextDescription, EventDescription, ModuleDependency, ModuleDescription, SubscriptionDescription, UseCaseDescription } from 'newt/contract'
export * from './structure.api'
