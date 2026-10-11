import { useLocation, useParams } from 'react-router'
import { Inline } from '@newt/ui/components/inline'
import { NavItem } from '@newt/ui/components/nav-item'

/** The parts of the definition in force (feature tree, rules, dimensions) and what is planned. */
export function DefinitionNav() {
  const base = `/w/${useParams().workspaceId}/definition`
  const path = useLocation().pathname
  const onRules = path.startsWith(`${base}/rules`)
  const onDimensions = path.startsWith(`${base}/dimensions`)
  const onPlanned = path.startsWith(`${base}/planned`)

  return (
    <nav aria-label="Definition">
      <Inline gap={1}>
        <NavItem href={base} active={!onRules && !onDimensions && !onPlanned}>Features</NavItem>
        <NavItem href={`${base}/rules`} active={onRules}>Rules</NavItem>
        <NavItem href={`${base}/dimensions`} active={onDimensions}>Dimensions</NavItem>
        <NavItem href={`${base}/planned`} active={onPlanned}>Planned</NavItem>
      </Inline>
    </nav>
  )
}
