import { LogOutIcon } from 'lucide-react'
import { Avatar } from '@newt-kit/react-ui/avatar'
import { Button } from '@newt-kit/react-ui/button'
import { Menu } from '@newt-kit/react-ui/menu'
import { useService, useValue } from '@newt-kit/react'
import { SessionService } from '../../services/session/session.service'

/** Who is signed in, with the way out. */
export function ShellUserMenu() {
  const session = useService(SessionService)
  const user = useValue(session.user)
  if (!user) return null

  return (
    <Menu
      label={`Signed in as ${user.user}`}
      align="end"
      trigger={
        <Button variant="ghost" size="icon" label={`${user.user}, open your menu`}>
          <Avatar name={user.user} size={7} />
        </Button>
      }
      items={[
        { label: `Signed in as ${user.user}`, disabled: true, onSelect: () => {} },
        { separator: true },
        { label: 'Sign out', icon: LogOutIcon, onSelect: () => void session.signOut() },
      ]}
    />
  )
}
