import { useLocation, useParams } from 'react-router'
import { Inline } from '@newt/ui/components/inline'
import { NavItem } from '@newt/ui/components/nav-item'

/** The parts of the definition: the feature tree and the dimensions. */
export function DefinitionNav() {
  const base = `/w/${useParams().workspaceId}/definition`
  const onDimensions = useLocation().pathname.startsWith(`${base}/dimensions`)

  return (
    <nav aria-label="Definition">
      <Inline gap={1}>
        <NavItem href={base} active={!onDimensions}>Features</NavItem>
        <NavItem href={`${base}/dimensions`} active={onDimensions}>Dimensions</NavItem>
      </Inline>
    </nav>
  )
}
