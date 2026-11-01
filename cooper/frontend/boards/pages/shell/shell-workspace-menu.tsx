import { useEffect } from 'react'
import { ChevronsUpDownIcon, LayersIcon, PlusIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '@newt-kit/react-ui/button'
import { Icon } from '@newt-kit/react-ui/icon'
import { Menu, type MenuItem } from '@newt-kit/react-ui/menu'
import { useService, useValue } from '@newt-kit/react'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

/** Which workspace you are in, and the way to any other. */
export function ShellWorkspaceMenu({ workspaceId }: { workspaceId: string | undefined }) {
  const workspaces = useService(WorkspacesService)
  const items = useValue(workspaces.items)
  const current = useValue(workspaces.workspace(workspaceId ?? ''))
  const navigate = useNavigate()

  useEffect(() => {
    void workspaces.load()
  }, [workspaces])

  const menu: MenuItem[] = [
    ...items.map(workspace => ({ label: workspace.name, icon: LayersIcon, onSelect: () => navigate(`/w/${workspace.id}`) })),
    ...(items.length > 0 ? [{ separator: true } as const] : []),
    { label: 'All workspaces', onSelect: () => navigate('/') },
    { label: 'New workspace', icon: PlusIcon, onSelect: () => navigate('/workspaces/new') },
  ]

  return (
    <Menu
      label="Switch workspace"
      align="start"
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
