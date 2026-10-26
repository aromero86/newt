import { LayersIcon, LogOutIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar } from '@cooper/ui/components/avatar'
import { Button } from '@cooper/ui/components/button'
import { Menu } from '@cooper/ui/components/menu'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
