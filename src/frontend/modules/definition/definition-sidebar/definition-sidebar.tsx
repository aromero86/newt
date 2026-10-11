import { useEffect } from 'react'
import { useLocation, useParams } from 'react-router'
import { CalendarClockIcon, FolderIcon, FolderTreeIcon, RulerIcon, ScrollTextIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { SideNav, SideNavHeading, SideNavItem } from '@newt/ui/components/side-nav'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { DefinitionSidebarService } from './definition-sidebar.service'

/** The definition's menu, like a repository's file tree: its parts, and its areas. */
export function DefinitionSidebar() {
  const workspaceId = useParams().workspaceId!
  const service = useService(DefinitionSidebarService)
  const areas = useValue(service.areas.items)
  const hasMore = useValue(service.areas.hasMore)
  const loadingMore = useValue(service.areas.loadingMore)
  const { pathname } = useLocation()
  const base = `/w/${workspaceId}/definition`
  const at = (path: string) => pathname === `${base}${path}` || pathname.startsWith(`${base}${path}/`)

  useEffect(() => {
    void service.load(workspaceId)
  }, [service, workspaceId])

  return (
    <SideNav label="Definition">
      <SideNavItem href={base} active={pathname === base} icon={FolderTreeIcon}>Areas and features</SideNavItem>
      <SideNavItem href={`${base}/rules`} active={at('/rules')} icon={ScrollTextIcon}>Rules</SideNavItem>
      <SideNavItem href={`${base}/dimensions`} active={at('/dimensions')} icon={RulerIcon}>Dimensions</SideNavItem>
      <SideNavItem href={`${base}/planned`} active={at('/planned')} icon={CalendarClockIcon}>Planned</SideNavItem>
      {areas.length > 0 && <SideNavHeading>Areas</SideNavHeading>}
      {areas.map(area => (
        <SideNavItem key={area.id} href={`${base}/areas/${area.id}`} active={at(`/areas/${area.id}`)} icon={FolderIcon}>{area.name}</SideNavItem>
      ))}
      {hasMore && <Button size="sm" variant="ghost" loading={loadingMore} onClick={() => void service.areas.loadMore()}>More areas</Button>}
    </SideNav>
  )
}
