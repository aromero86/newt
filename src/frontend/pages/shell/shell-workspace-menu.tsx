import { useEffect } from 'react'
import { ChevronsUpDownIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { Menu, type MenuItem } from '@newt/ui/components/menu'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Which workspace you are in, and the way to any other. */
export function ShellWorkspaceMenu({ workspaceId }: { workspaceId: string | undefined }) {
  const workspaces = useService(WorkspacesService)
  const items = useValue(workspaces.list.items)
  const loaded = useValue(workspaces.list.loaded)
  const current = useValue(workspaces.workspace(workspaceId ?? ''))
  const navigate = useNavigate()

  // The menu shows the first page; "All workspaces" has the rest.
  useEffect(() => {
    if (!loaded) void workspaces.list.loadFirstPage()
  }, [workspaces, loaded])

  const menu: MenuItem[] = [
    ...items.map(workspace => ({ label: workspace.name, icon: LayersIcon, onSelect: () => navigate(`/w/${workspace.id}`) })),
    ...(items.length > 0 ? [{ separator: true } as const] : []),
    { label: 'All workspaces', onSelect: () => navigate('/workspaces') },
    { label: 'New workspace', icon: PlusIcon, onSelect: () => navigate('/workspaces/new') },
  ]

  return (
    <Menu
      label="Switch workspace"
      trigger={
        <Button variant="ghost" size="sm" label={current ? `Workspace ${current.name}, switch` : 'Choose a workspace'}>
          {current?.name ?? 'Workspaces'}
          <Icon icon={ChevronsUpDownIcon} size="sm" tone="muted" />
        </Button>
      }
      items={menu}
    />
  )
}
