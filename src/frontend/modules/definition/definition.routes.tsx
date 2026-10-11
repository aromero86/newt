import { Route, Routes } from 'react-router'
import { SidebarLayout } from '@newt/ui/components/sidebar-layout'
import { Provide } from '../../core/injector/provide'
import { NotFound } from '../../pages/not-found/not-found'
import { DefinitionArea } from './definition-area/definition-area'
import { DefinitionAreas } from './definition-areas/definition-areas'
import { DefinitionDimensions } from './definition-dimensions/definition-dimensions'
import { DefinitionFeature } from './definition-feature/definition-feature'
import { DefinitionPlanned } from './definition-planned/definition-planned'
import { DefinitionRule } from './definition-rule/definition-rule'
import { DefinitionRulesPage } from './definition-rules/definition-rules-page'
import { DefinitionSidebar } from './definition-sidebar/definition-sidebar'
import { DefinitionSidebarService } from './definition-sidebar/definition-sidebar.service'

/** The definition zone's own routes, below /definition, beside its menu. */
export function DefinitionRoutes() {
  return (
    <Provide services={[DefinitionSidebarService]}>
      <SidebarLayout aside={<DefinitionSidebar />}>
        <Routes>
          <Route index element={<DefinitionAreas />} />
          <Route path="areas/:areaId" element={<DefinitionArea />} />
          <Route path="features/:featureId" element={<DefinitionFeature />} />
          <Route path="rules" element={<DefinitionRulesPage />} />
          <Route path="rules/:key" element={<DefinitionRule />} />
          <Route path="dimensions" element={<DefinitionDimensions />} />
          <Route path="planned" element={<DefinitionPlanned />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </SidebarLayout>
    </Provide>
  )
}
