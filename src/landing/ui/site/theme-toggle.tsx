import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@newt/ui/components/button'
import { Icon } from '@newt/ui/components/icon'

/** Dark by default; the choice is remembered. layout.astro applies it before the page paints. */
export function ThemeToggle({ toLight, toDark }: { toLight: string; toDark: string }) {
  // The server does not know the theme: dark until the browser says otherwise.
  const [dark, setDark] = useState(true)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('newt-theme', next ? 'dark' : 'light')
    } catch {
      // Storage may be unavailable (private mode): the toggle still works for this visit.
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} label={dark ? toLight : toDark}>
      <Icon icon={dark ? SunIcon : MoonIcon} />
    </Button>
  )
}
