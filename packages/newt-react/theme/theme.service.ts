import { effect } from '@preact/signals-core'
import type { Disposable } from '../injector/disposable'
import { Store } from '../store/store'

export type Theme = 'light' | 'dark'

/** Where the choice is kept. Each app has its own origin, so each keeps its own. */
export const THEME_STORAGE_KEY = 'newt-theme'

/** The visitor's choice, if they made one. */
function savedTheme(): Theme | undefined {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable (private mode): no choice is kept.
  }
  return undefined
}

/**
 * Light or dark, for the whole app, as newt-kit-react-ui's theme reads it: the `dark`
 * class on <html>. An app's index.html applies it before the first paint (reading
 * `THEME_STORAGE_KEY`); this service keeps it in step afterwards, following the
 * system while the visitor has made no choice.
 */
export class ThemeService implements Disposable {

  /** What the system prefers; absent where there is no matchMedia. */
  private readonly systemDark = typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : undefined

  private readonly store = new Store<{ theme: Theme }>({
    theme: savedTheme() ?? (this.systemDark?.matches ? 'dark' : 'light'),
  })

  readonly theme = this.store.select('theme')

  private readonly stopApplying = effect(() => {
    document.documentElement.classList.toggle('dark', this.theme.value === 'dark')
  })

  private readonly followSystem = (event: MediaQueryListEvent): void => {
    if (savedTheme()) return
    this.store.patch({ theme: event.matches ? 'dark' : 'light' })
  }

  constructor() {
    this.systemDark?.addEventListener('change', this.followSystem)
  }

  toggle(): void {
    const theme = this.store.value.theme === 'dark' ? 'light' : 'dark'
    this.store.patch({ theme })
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // The choice still applies for this visit.
    }
  }

  dispose(): void {
    this.stopApplying()
    this.systemDark?.removeEventListener('change', this.followSystem)
  }
}
