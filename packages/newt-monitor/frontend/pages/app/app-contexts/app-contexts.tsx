import { Fragment } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { BlocksIcon, BoxIcon, LayersIcon } from 'lucide-react'
import { SideNav, SideNavItem } from 'newt-react-ui/side-nav'
import { SidebarLayout } from 'newt-react-ui/sidebar-layout'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import type { ApplicationDescription } from '../../../api/structure'
import { NotFound } from '../../not-found/not-found'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppService } from '../app.service'
import { contextHref } from '../app-structure'
import { AppContext } from './app-context'
import { AppContextList } from './app-context-list'
import { AppModule } from './app-module'

/** The Contexts tab: a tree of its contexts and their modules beside the page of the one chosen. */
export function AppContexts({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  if (!structure) return <AppNotRead app={app} />
  const { description } = structure

  return (
    <SidebarLayout aside={<AppContextsTree appId={app.id} description={description} />} menuLabel="Contexts and modules">
      <Routes>
        <Route index element={<AppContextList appId={app.id} description={description} />} />
        <Route path=":context" element={<AppContext appId={app.id} description={description} />} />
        <Route path=":context/modules/:module" element={<AppModule appId={app.id} description={description} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </SidebarLayout>
  )
}

/** Its contexts, like a repository's folders: the one you are in opened, with its modules. */
function AppContextsTree({ appId, description }: { appId: string, description: ApplicationDescription }) {
  const { pathname } = useLocation()
  const all = `/apps/${appId}/contexts`

  return (
    <SideNav label="Contexts and modules">
      <SideNavItem href={all} active={pathname === all} icon={LayersIcon}>All contexts</SideNavItem>
      {description.contexts.map(context => {
        const href = contextHref(appId, context.name)
        const open = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Fragment key={context.name}>
            <SideNavItem href={href} active={pathname === href} icon={BlocksIcon}>{context.name}</SideNavItem>
            {open && context.modules.map(module => {
              const moduleHref = `${href}/modules/${module.name}`
              return <SideNavItem key={module.id} href={moduleHref} active={pathname === moduleHref} icon={BoxIcon} level={1}>{module.name}</SideNavItem>
            })}
          </Fragment>
        )
      })}
    </SideNav>
  )
}
