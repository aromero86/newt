// The contract comes from the backend module; the client is ours.
export type { RefreshDTO, StructureVersionDTO, StructureVersionSummaryDTO } from '../../../backend/contexts/monitor/modules/structure/structure.schema'
export type { ApplicationDescription, ContextDescription, EventDescription, ModuleDependency, ModuleDescription, SubscriptionDescription, UseCaseDescription } from '@newt-kit/newt/contract'
export * from './structure.api'
