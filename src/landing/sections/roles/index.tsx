import type { ReactNode } from 'react'
import { BriefcaseBusinessIcon, CodeXmlIcon, FlaskConicalIcon, LifeBuoyIcon, LightbulbIcon, type LucideIcon } from 'lucide-react'
import { Icon } from '@newt/ui/components/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@newt/ui/components/tabs'
import type { Lang } from '../../i18n'
import { storyIn } from '../../story'
import { Section, SectionHeading } from '../../ui/site/section'
import { RoleIntro, RolePanel, RoleTabsBar } from '../../ui/scenes/roles/roles'
import { Stage } from '../../ui/scenes/roles/stage'
import { rolesStory } from '../../ui/scenes/roles/story'
import { SupportScene } from '../../ui/scenes/roles/support'
import { ProductScene } from '../../ui/scenes/roles/product'
import { DevelopmentScene } from '../../ui/scenes/roles/development'
import { QaScene } from '../../ui/scenes/roles/qa'
import { SalesScene } from '../../ui/scenes/roles/sales'
import { content, type Role } from './content'

/** The same definition, seen from each seat: one tab per role, each with a day acted out. */
export function RolesSection({ lang }: { lang: Lang }) {
  const copy = content[lang]
  const story = rolesStory(storyIn(lang), copy.story)
  const { people } = story

  const roles: { id: string; icon: LucideIcon; person: string; role: Role; scene: (step: number) => ReactNode }[] = [
    { id: 'support', icon: LifeBuoyIcon, person: people.support, role: copy.support, scene: step => <SupportScene step={step} copy={copy.support.scene} story={story} /> },
    { id: 'product', icon: LightbulbIcon, person: people.product, role: copy.product, scene: step => <ProductScene step={step} copy={copy.product.scene} story={story} /> },
    {
      id: 'development',
      icon: CodeXmlIcon,
      person: people.dev,
      role: copy.development,
      scene: step => <DevelopmentScene step={step} copy={copy.development.scene} story={story} />,
    },
    { id: 'qa', icon: FlaskConicalIcon, person: people.qa, role: copy.qa, scene: step => <QaScene step={step} copy={copy.qa.scene} story={story} /> },
    { id: 'sales', icon: BriefcaseBusinessIcon, person: people.sales, role: copy.sales, scene: step => <SalesScene step={step} copy={copy.sales.scene} story={story} /> },
  ]

  return (
    <Section id="roles">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title}>
        {copy.lead}
      </SectionHeading>

      <Tabs defaultValue="product">
        <RoleTabsBar>
          <TabsList label={copy.tabs}>
            {roles.map(r => (
              <TabsTrigger key={r.id} value={r.id}>
                <Icon icon={r.icon} /> {r.role.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </RoleTabsBar>

        {roles.map(r => (
          <TabsContent key={r.id} value={r.id}>
            <RolePanel>
              <RoleIntro person={r.person} seat={r.role.seat} gets={r.role.gets} />
              <Stage steps={r.role.steps} copy={copy.stage}>
                {r.scene}
              </Stage>
            </RolePanel>
          </TabsContent>
        ))}
      </Tabs>
    </Section>
  )
}
