import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Whoever asked their system for less motion gets every animation at its end. */
export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Calls `enter` when the element comes into view, and `leave` when it goes, until the component goes. */
export function onInView(target: Ref<HTMLElement | undefined>, enter: () => void, options: { threshold?: number, once?: boolean, leave?: () => void } = {}): void {
  let observer: IntersectionObserver | undefined
  onMounted(() => {
    if (!target.value) return
    if (!('IntersectionObserver' in window)) { enter(); return }
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          enter()
          if (options.once) observer?.disconnect()
        } else options.leave?.()
      }
    }, { threshold: options.threshold ?? 0.25 })
    observer.observe(target.value)
  })
  onBeforeUnmount(() => observer?.disconnect())
}

/** Timers that all stop with the component. */
export function useTimers() {
  const pending = new Set<ReturnType<typeof setTimeout>>()
  onBeforeUnmount(() => { for (const each of pending) clearTimeout(each) })
  return {
    after(ms: number, run: () => void) {
      const id = setTimeout(() => { pending.delete(id); run() }, ms)
      pending.add(id)
    },
    clear() { for (const each of pending) clearTimeout(each); pending.clear() },
  }
}
