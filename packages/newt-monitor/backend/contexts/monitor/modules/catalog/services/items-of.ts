import type { ApplicationDescription } from 'newt-kit/contract'
import type { DescribedItem } from '../catalog.schema'

/** Every context, module, use case and event a description has, each as the catalog keeps it. */
export function itemsOf(description: ApplicationDescription): DescribedItem[] {
  return description.contexts.flatMap(context => [
    { kind: 'context' as const, itemId: context.name, context: context.name, module: null, name: context.name, details: { uses: context.uses } },
    ...context.modules.flatMap(module => [
      { kind: 'module' as const, itemId: module.id, context: context.name, module: module.name, name: module.name, details: { className: module.className, deps: module.deps } },
      ...module.useCases.map(useCase => ({
        kind: 'useCase' as const, itemId: useCase.id, context: context.name, module: module.name, name: useCase.name,
        details: { writesTo: useCase.writesTo, retryOnConflict: useCase.retryOnConflict },
      })),
      ...module.events.map(event => ({
        kind: 'event' as const, itemId: event.id, context: context.name, module: module.name, name: event.name,
        details: { schedule: event.schedule },
      })),
    ]),
  ])
}
