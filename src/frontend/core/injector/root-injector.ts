import { Injector } from './injector'

/** The app-wide injector: services nobody provides live here, one instance each. */
export const rootInjector = new Injector()
