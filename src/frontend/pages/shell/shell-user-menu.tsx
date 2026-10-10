import { LogOutIcon, SettingsIcon } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Avatar } from '@newt/ui/components/avatar'
import { Button } from '@newt/ui/components/button'
import { Menu } from '@newt/ui/components/menu'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { SessionService } from '../../services/session/session.service'

/** Who is signed in, with the way to their settings and out. */
export function ShellUserMenu() {
  const session = useService(SessionService)
  const user = useValue(session.user)
  const navigate = useNavigate()
  if (!user) return null

  return (
    <Menu
      label={`Signed in as @${user.nick}`}
      align="end"
      trigger={
        <Button variant="ghost" size="sm" label={`@${user.nick}, open your menu`}>
          <Avatar name={user.fullName} size={6} />
          {user.nick}
        </Button>
      }
      items={[
        { label: 'Account settings', icon: SettingsIcon, onSelect: () => navigate('/settings') },
        { separator: true },
        // Signing out sends the session guard back to the sign-in page.
        { label: 'Sign out', icon: LogOutIcon, onSelect: () => void session.signOut() },
      ]}
    />
  )
}
