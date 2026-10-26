import { effect } from '@preact/signals-core'
import type { Disposable } from '../injector/disposable'
import { Store } from '../store/store'

export type Theme = 'light' | 'dark'

/** Where the choice is kept. Each app has its own origin, so each keeps its own. */
export const THEME_STORAGE_KEY = 'cooper-theme'

/** The visitor's choice if they made one, otherwise what their system prefers. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable (private mode): fall back to the system.
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Light or dark, for the whole app. Each app's index.html applies it before the
 * first paint; this service keeps the `dark` class on <html> in step afterwards.
 */
export class ThemeService implements Disposable {

  private readonly store = new Store<{ theme: Theme }>({ theme: initialTheme() })

  readonly theme = this.store.select('theme')

  private readonly stopApplying = effect(() => {
    document.documentElement.classList.toggle('dark', this.theme.value === 'dark')
  })

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
  }
}
