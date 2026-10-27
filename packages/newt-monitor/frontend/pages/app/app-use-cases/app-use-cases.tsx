import { useState } from 'react'
import { BlocksIcon, PlayIcon, SearchXIcon } from 'lucide-react'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { SearchField } from 'newt-react-ui/search-field'
import { Inline } from 'newt-react-ui/inline'
import { Stack } from 'newt-react-ui/stack'
import { Mono } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { AppNotRead } from '../app-not-read/app-not-read'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { AppService } from '../app.service'
import { contextHref, matches, moduleHref } from '../app-structure'

/** Every use case of the application, by context and module, with a filter. */
export function AppUseCases({ app }: { app: AppDTO }) {
  const service = useService(AppService)
  const structure = useValue(service.structure)
  const [filter, setFilter] = useState('')
  const removed = useRemoved()
  if (!structure) return <AppNotRead app={app} />

  const gone = removed.filter(item => item.kind === 'useCase' && matches(item.itemId, filter))
  const current = structure.description.contexts.map(context => context.name)
  const contexts = [...structure.description.contexts, ...[...new Set(gone.map(item => item.context))].filter(name => !current.includes(name)).map(name => ({ name, modules: [] }))]
    .map(context => ({
      ...context,
      gone: gone.filter(item => item.context === context.name),
      useCases: context.modules.flatMap(module => module.useCases.map(useCase => ({ ...useCase, module }))).filter(useCase => matches(useCase.id, filter)),
    }))
    .filter(context => context.useCases.length > 0 || context.gone.length > 0)

  return (
    <Stack gap={4}>
      <Inline gap={2}>
        <SearchField live label="Filter use cases" placeholder="Filter use cases: card create" onSearch={setFilter} />
        <AppRemovedToggle />
      </Inline>
      {contexts.length === 0 && (
        <Box label="Use cases">
          <BoxEmpty icon={SearchXIcon} title="No use case matches" description="Every word is looked for in its context, its module and its name." />
        </Box>
      )}
      {contexts.map(context => (
        <Box key={context.name} label={`Use cases of ${context.name}`}>
          <BoxHeader><Icon icon={BlocksIcon} tone="muted" /> <TextLink href={contextHref(app.id, context.name)}>{context.name}</TextLink> <Counter>{context.useCases.length + context.gone.length}</Counter></BoxHeader>
          {context.useCases.map(useCase => (
            <BoxRow key={useCase.id} leading={<Icon icon={PlayIcon} tone="muted" />}>
              <BoxRowTitle href={moduleHref(app.id, useCase.module.id)}><Mono>{useCase.name}</Mono></BoxRowTitle>
              <BoxRowMeta>
                <>{useCase.writesTo.length ? `writes also to ${useCase.writesTo.join(', ')}` : 'writes only to its own module'}</>
                {!useCase.retryOnConflict && <>never retried on a conflict</>}
              </BoxRowMeta>
            </BoxRow>
          ))}
          {context.gone.map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(app.id, `${item.context}/${item.module}`)} />)}
        </Box>
      ))}
    </Stack>
  )
}
