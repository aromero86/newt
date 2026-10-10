import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from 'cn'

/**
 * Types `text` out character by character while `active`. Shows it whole with
 * reduced motion, or once `active` has been true and the typing finished.
 */
export function useTypewriter(text: string, active: boolean, { speed = 28 } = {}) {
  const reduced = useReducedMotion()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!active) {
      setCount(0)
      return
    }
    if (reduced) return
    if (count >= text.length) return
    const id = setTimeout(() => setCount(c => c + 1), speed)
    return () => clearTimeout(id)
  }, [active, count, text, speed, reduced])

  if (reduced) return { shown: active ? text : '', done: active }
  return { shown: text.slice(0, count), done: count >= text.length }
}

/** Text that types itself in, with a blinking caret while it types. */
export function Typing({ text, active, className, speed }: { text: string; active: boolean; className?: string; speed?: number }) {
  const { shown, done } = useTypewriter(text, active, { speed })
  return (
    <span className={className}>
      {shown}
      {active && !done && <Caret />}
    </span>
  )
}

export function Caret({ className }: { className?: string }) {
  return (
    <motion.span
      aria-hidden
      className={cn('ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] bg-current', className)}
      animate={{ opacity: [1, 0, 1] }}
      transition={{ duration: 1, repeat: Infinity }}
    />
  )
}

/**
 * A pretend mouse pointer for scripted demos. Position it in % of its
 * positioned parent; `click` plays a ripple. Purely decorative.
 */
export function FakeCursor({ x, y, click = false, visible = true }: { x: number; y: number; click?: boolean; visible?: boolean }) {
  // Decorative and only meaningful in motion: not shown with reduced motion.
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute z-30"
      initial={false}
      animate={{ left: `${x}%`, top: `${y}%`, opacity: visible ? 1 : 0 }}
      transition={{ type: 'spring', stiffness: 120, damping: 20 }}
    >
      {click && (
        <motion.span
          key={`${x}-${y}`}
          className="absolute -top-3 -left-3 size-6 rounded-full bg-brand/40"
          initial={{ scale: 0.2, opacity: 0.9 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 0.6 }}
        />
      )}
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow-md">
        <path d="M2 1.5 15 8l-6 1.6L6.4 16z" fill="white" stroke="black" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </motion.div>
  )
}
