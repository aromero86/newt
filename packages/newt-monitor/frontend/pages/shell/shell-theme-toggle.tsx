import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from 'newt-kit-react-ui/button'
import { Icon } from 'newt-kit-react-ui/icon'
import { useService, useValue, ThemeService } from 'newt-kit-react'

export function ShellThemeToggle() {
  const themes = useService(ThemeService)
  const theme = useValue(themes.theme)

  return (
    <Button variant="ghost" size="icon" label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => themes.toggle()}>
      <Icon icon={theme === 'dark' ? SunIcon : MoonIcon} />
    </Button>
  )
}
