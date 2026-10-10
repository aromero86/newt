import type { ReactNode } from 'react'
import {
  DropdownMenu as ShadcnDropdownMenu,
  DropdownMenuContent as ShadcnDropdownMenuContent,
  DropdownMenuItem as ShadcnDropdownMenuItem,
  DropdownMenuSeparator as ShadcnDropdownMenuSeparator,
  DropdownMenuTrigger as ShadcnDropdownMenuTrigger,
} from '../../shadcn/dropdown-menu'
import type { IconComponent } from '../icon'

export type MenuAction = {
  label: string
  onSelect: () => void
  tone?: 'default' | 'destructive'
  disabled?: boolean
  icon?: IconComponent
}

export type MenuItem = MenuAction | { separator: true }

type MenuProps = {
  /** What opens the menu: one @newt/ui `Button`. */
  trigger: ReactNode
  items: MenuItem[]
  /** The menu's accessible name. */
  label: string
  align?: 'start' | 'end'
}

/** A list of actions that opens from a button. Arrow keys move, Escape closes. */
export function Menu({ trigger, items, label, align = 'end' }: MenuProps) {
  return (
    <ShadcnDropdownMenu>
      <ShadcnDropdownMenuTrigger asChild>{trigger}</ShadcnDropdownMenuTrigger>
      <ShadcnDropdownMenuContent align={align} aria-label={label} aria-labelledby={undefined}>
        {items.map((item, index) => {
          if ('separator' in item) return <ShadcnDropdownMenuSeparator key={index} />
          const Glyph = item.icon
          return (
            <ShadcnDropdownMenuItem key={index} variant={item.tone ?? 'default'} disabled={item.disabled} onSelect={item.onSelect}>
              {Glyph && <Glyph aria-hidden />}
              {item.label}
            </ShadcnDropdownMenuItem>
          )
        })}
      </ShadcnDropdownMenuContent>
    </ShadcnDropdownMenu>
  )
}
