import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Injector } from './injector'
import { InjectorContext } from './injector-context'
import type { ServiceClass } from './service-class'

/**
 * Gives the components below their own instances of `services`, which live as long
 * as this element. Provide a service in the lowest ancestor of the components that
 * share it.
 */
export function Provide({ services, children }: { services: ServiceClass[], children: ReactNode }) {
  const parent = useContext(InjectorContext)
  const [injector] = useState(() => new Injector(parent, services))
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      // StrictMode unmounts and mounts again at once in development: only a real
      // unmount, still unmounted a moment later, releases the services.
      queueMicrotask(() => {
        if (!mounted.current) injector.dispose()
      })
    }
  }, [injector])

  return <InjectorContext.Provider value={injector}>{children}</InjectorContext.Provider>
}
