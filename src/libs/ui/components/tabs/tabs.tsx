import type { ReactNode } from 'react'
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList as ShadcnTabsList, TabsTrigger as ShadcnTabsTrigger } from '../../shadcn/tabs'

type TabsProps = {
  defaultValue: string
  children: ReactNode
}

export function Tabs({ defaultValue, children }: TabsProps) {
  return (
    <ShadcnTabs defaultValue={defaultValue} className="gap-6">
      {children}
    </ShadcnTabs>
  )
}

export function TabsList({ label, children }: { label?: string; children: ReactNode }) {
  return <ShadcnTabsList aria-label={label}>{children}</ShadcnTabsList>
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return <ShadcnTabsTrigger value={value}>{children}</ShadcnTabsTrigger>
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  return <ShadcnTabsContent value={value}>{children}</ShadcnTabsContent>
}
