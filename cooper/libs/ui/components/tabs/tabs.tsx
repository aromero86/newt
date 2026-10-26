import { createContext, useContext, type ReactNode } from 'react'
import { cn } from 'cn'
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList as ShadcnTabsList, TabsTrigger as ShadcnTabsTrigger } from '../../shadcn/tabs'

/** `pills`, boxed and compact; `underline`, the parts of a page, like a pull request's on GitHub. */
type Variant = 'pills' | 'underline'

const VariantContext = createContext<Variant>('pills')

type TabsProps = {
  defaultValue: string
  variant?: Variant
  children: ReactNode
}

export function Tabs({ defaultValue, variant = 'pills', children }: TabsProps) {
  return (
    <VariantContext.Provider value={variant}>
      <ShadcnTabs defaultValue={defaultValue} className={variant === 'underline' ? 'gap-5' : 'gap-6'}>
        {children}
      </ShadcnTabs>
    </VariantContext.Provider>
  )
}

export function TabsList({ label, children }: { label?: string; children: ReactNode }) {
  const variant = useContext(VariantContext)
  return (
    <ShadcnTabsList
      aria-label={label}
      className={cn(variant === 'underline' && 'h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0')}
    >
      {children}
    </ShadcnTabsList>
  )
}

export function TabsTrigger({ value, count, children }: { value: string; count?: number; children: ReactNode }) {
  const variant = useContext(VariantContext)
  return (
    <ShadcnTabsTrigger
      value={value}
      className={cn(
        variant === 'underline' &&
          '-mb-px h-auto flex-none gap-2 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 pt-1 pb-2.5 text-muted-foreground shadow-none hover:text-foreground focus-visible:border-x-0 focus-visible:border-t-0 focus-visible:ring-0 focus-visible:outline-none focus-visible:text-foreground data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-brand dark:data-[state=active]:bg-transparent',
      )}
    >
      {children}
      {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] leading-5 font-medium text-muted-foreground tabular-nums">{count}</span>}
    </ShadcnTabsTrigger>
  )
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return <ShadcnTabsContent value={value}>{children}</ShadcnTabsContent>
}
