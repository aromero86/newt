import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@cooper/ui/components/button'
import { Icon } from '@cooper/ui/components/icon'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { ThemeService } from '@cooper/core/theme/theme.service'

export function ShellThemeToggle() {
  const themes = useService(ThemeService)
  const theme = useValue(themes.theme)

  return (
    <Button variant="ghost" size="icon" label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => themes.toggle()}>
      <Icon icon={theme === 'dark' ? SunIcon : MoonIcon} />
    </Button>
  )
}
