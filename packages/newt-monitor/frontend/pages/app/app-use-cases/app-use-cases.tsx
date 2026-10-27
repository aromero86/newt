import { useState } from 'react'
import { BlocksIcon, PlayIcon, SearchXIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { SearchField } from 'newt-react-ui/search-field'
import { Stack } from 'newt-react-ui/stack'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppService } from '../app.service'
import { contextHref, matches, moduleHref } from '../app-structure'

/** Every use case of the application, by context and module, with a filter. */
export function AppUseCases({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const [filter, setFilter] = useState('')
  if (!structure) return <AppNotRead app={app} />

  const contexts = structure.description.contexts
    .map(context => ({
      ...context,
      useCases: context.modules.flatMap(module => module.useCases.map(useCase => ({ ...useCase, module }))).filter(useCase => matches(useCase.id, filter)),
    }))
    .filter(context => context.useCases.length > 0)

  return (
    <Stack gap={4}>
      <SearchField live label="Filter use cases" placeholder="Filter use cases: card create" onSearch={setFilter} />
      {contexts.length === 0 && (
        <Box label="Use cases">
          <BoxEmpty icon={SearchXIcon} title="No use case matches" description="Every word is looked for in its context, its module and its name." />
        </Box>
      )}
      {contexts.map(context => (
        <Box key={context.name} label={`Use cases of ${context.name}`}>
          <BoxHeader><Icon icon={BlocksIcon} tone="muted" /> <TextLink href={contextHref(app.id, context.name)}>{context.name}</TextLink> <Counter>{context.useCases.length}</Counter></BoxHeader>
          {context.useCases.map(useCase => (
            <BoxRow key={useCase.id} leading={<Icon icon={PlayIcon} tone="muted" />}>
              <BoxRowTitle href={moduleHref(app.id, useCase.module.id)}><Mono>{useCase.name}</Mono></BoxRowTitle>
              <BoxRowMeta>
                <>{useCase.writesTo.length ? `writes also to ${useCase.writesTo.join(', ')}` : 'writes only to its own module'}</>
                {!useCase.retryOnConflict && <>never retried on a conflict</>}
              </BoxRowMeta>
            </BoxRow>
          ))}
        </Box>
      ))}
    </Stack>
  )
}
