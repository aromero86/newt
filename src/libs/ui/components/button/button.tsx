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

type Size = 'sm' | 'md' | 'lg'

const shadcnSize = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
} as const satisfies Record<Size, string>

type ButtonProps = {
  variant?: Variant
  size?: Size
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: MouseEventHandler<HTMLButtonElement>
  children: ReactNode
}

/** The only button apps use. It takes no class names or styles on purpose. */
export function Button({ variant = 'primary', size = 'md', type = 'button', disabled, onClick, children }: ButtonProps) {
  return (
    <ShadcnButton variant={shadcnVariant[variant]} size={shadcnSize[size]} type={type} disabled={disabled} onClick={onClick}>
      {children}
    </ShadcnButton>
  )
}
