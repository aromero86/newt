import { useContext, type MouseEventHandler, type ReactElement, type ReactNode } from 'react'
import { Button as ShadcnButton } from '../../shadcn/button'
import { Spinner as ShadcnSpinner } from '../../shadcn/spinner'
import { LinkComponentContext } from '../link/link-component'

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
  /** Shows a spinner before the content and disables the button until it is done. */
  loading?: boolean
  onClick?: MouseEventHandler<HTMLElement>
  /** Accessible name, for buttons whose content does not say what they do. */
  label?: string
  /** As wide as its container: the one action of a narrow form. */
  block?: boolean
  children: ReactNode
}

// Props and the ref that a Radix trigger (such as `Menu`'s) puts on its child.
// They are passed through so a Button can open a menu, but apps cannot set them.
type TriggerProps = Record<string, unknown>

function ButtonImpl({
  variant = 'primary',
  size = 'md',
  href,
  type = 'button',
  disabled,
  loading = false,
  onClick,
  label,
  block = false,
  children,
  ...trigger
}: ButtonProps & TriggerProps) {
  const Link = useContext(LinkComponentContext)
  const look = { variant: shadcnVariant[variant], size: shadcnSize[size], className: block ? 'w-full' : undefined }
  if (href !== undefined) {
    return (
      <ShadcnButton {...look} asChild>
        <Link {...trigger} href={href} aria-label={label} onClick={onClick}>
          {children}
        </Link>
      </ShadcnButton>
    )
  }
  return (
    <ShadcnButton
      {...trigger}
      {...look}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      aria-label={label}
    >
      {loading && <ShadcnSpinner role={undefined} aria-label={undefined} aria-hidden />}
      {children}
    </ShadcnButton>
  )
}

/** The only button apps use. It takes no class names or styles on purpose. */
export const Button: (props: ButtonProps) => ReactElement = ButtonImpl
