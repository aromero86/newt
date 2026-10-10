import { Route, Routes } from 'react-router'
import { Stack } from '@newt/ui/components/stack'
import { NotFound } from '../../pages/not-found/not-found'
import { DefinitionArea } from './definition-area/definition-area'
import { DefinitionAreas } from './definition-areas/definition-areas'
import { DefinitionDimensions } from './definition-dimensions/definition-dimensions'
import { DefinitionFeature } from './definition-feature/definition-feature'
import { DefinitionNav } from './definition-nav/definition-nav'

/** The definition zone's own routes, below /definition. */
export function DefinitionRoutes() {
  return (
    <Stack gap={6}>
      <DefinitionNav />
      <Routes>
        <Route index element={<DefinitionAreas />} />
        <Route path="areas/:areaId" element={<DefinitionArea />} />
        <Route path="features/:featureId" element={<DefinitionFeature />} />
        <Route path="dimensions" element={<DefinitionDimensions />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Stack>
  )
}
