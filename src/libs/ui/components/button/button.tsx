import type { MouseEventHandler, ReactNode } from 'react'
import { Button as ShadcnButton } from '../../shadcn/button'

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link'

const shadcnVariant = {
  primary: 'default',
  secondary: 'secondary',
  outline: 'outline',
  ghost: 'ghost',
  destructive: 'destructive',
  link: 'link',
} as const satisfies Record<Variant, string>

/** `icon` and `icon-sm` are square buttons that only hold an icon: give them a `label`. */
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const shadcnSize = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
  icon: 'icon',
  'icon-sm': 'icon-sm',
} as const satisfies Record<Size, string>

type ButtonProps = {
  variant?: Variant
  size?: Size
  /** With `href` the button is a link. */
  href?: string
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLElement>
  /** Accessible name, for buttons whose content does not say what they do. */
  label?: string
  children: ReactNode
}

/** The only button apps use. It takes no class names or styles on purpose. */
export function Button({ variant = 'primary', size = 'md', href, type = 'button', disabled, onClick, label, children }: ButtonProps) {
  const look = { variant: shadcnVariant[variant], size: shadcnSize[size] }
  if (href !== undefined) {
    return (
      <ShadcnButton {...look} asChild>
        <a href={href} aria-label={label} onClick={onClick}>
          {children}
        </a>
      </ShadcnButton>
    )
  }
  return (
    <ShadcnButton {...look} type={type} disabled={disabled} onClick={onClick} aria-label={label}>
      {children}
    </ShadcnButton>
  )
}
