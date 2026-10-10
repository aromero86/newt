// Stands in for next-themes, which shadcn's sonner imports. newt switches
// themes by toggling the `dark` class on <html>, so this hook watches it.

import { useSyncExternalStore } from "react"

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

function getTheme(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

// Dark is the default theme, so that is what the server renders.
function getServerTheme(): "dark" {
  return "dark"
}

export function useTheme(): { theme: "dark" | "light" } {
  return { theme: useSyncExternalStore(subscribe, getTheme, getServerTheme) }
}
