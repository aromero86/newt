import { effect } from '@preact/signals-core'
import type { Disposable } from '../../core/injector/disposable'
import { Store } from '../../core/store/store'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'newt-theme'

/** The visitor's choice if they made one, otherwise what their system prefers. */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be unavailable (private mode): fall back to the system.
  }
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Light or dark, for the whole app. index.html applies it before the first paint. */
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
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // The choice still applies for this visit.
    }
  }

  dispose(): void {
    this.stopApplying()
  }
}
