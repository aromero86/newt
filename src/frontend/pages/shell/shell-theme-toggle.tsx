import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { ThemeService } from '../../services/theme/theme.service'

export function ShellThemeToggle() {
  const themes = useService(ThemeService)
  const theme = useValue(themes.theme)

  return (
    <Button variant="ghost" size="icon" label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => themes.toggle()}>
      <Icon icon={theme === 'dark' ? SunIcon : MoonIcon} />
    </Button>
  )
}
