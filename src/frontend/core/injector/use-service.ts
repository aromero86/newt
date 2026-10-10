import { useContext } from 'react'
import { InjectorContext } from './injector-context'
import type { ServiceClass } from './service-class'

/** For components: the instance from the closest `Provide` above, or the app-wide one. */
export function useService<T>(service: ServiceClass<T>): T {
  return useContext(InjectorContext).get(service)
}
