import { createContext } from 'react'
import { rootInjector } from './root-injector'

export const InjectorContext = createContext(rootInjector)
