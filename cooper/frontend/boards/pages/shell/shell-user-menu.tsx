import { LayersIcon, LogOutIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar } from '@newt-kit/react-ui/avatar'
import { Button } from '@newt-kit/react-ui/button'
import { Menu } from '@newt-kit/react-ui/menu'
import { useService, useValue } from '@newt-kit/react'
import { SessionService } from '../../services/session/session.service'

/** Who is signed in, with the way to their workspaces and out. */
export function ShellUserMenu() {
  const session = useService(SessionService)
  const user = useValue(session.user)
  const navigate = useNavigate()
  if (!user) return null

  return (
    <Menu
      label={`Signed in as ${user.email}`}
      align="end"
      trigger={
        <Button variant="ghost" size="icon" label={`${user.name}, open your menu`}>
          <Avatar name={user.name} size={7} />
        </Button>
      }
      items={[
        { label: `Signed in as ${user.email}`, disabled: true, onSelect: () => {} },
        { separator: true },
        { label: 'Your workspaces', icon: LayersIcon, onSelect: () => navigate('/') },
        { separator: true },
        // Signing out goes through auth, which ends its session too, and comes back to the start.
        { label: 'Sign out', icon: LogOutIcon, onSelect: () => void session.signOut() },
      ]}
    />
  )
}
