import { Injector } from './injector'
import { rootInjector } from './root-injector'
import type { ServiceClass } from './service-class'

/** For services: the instance of another service, from this service's level or above. */
export function inject<T>(service: ServiceClass<T>): T {
  return (Injector.current ?? rootInjector).get(service)
}
