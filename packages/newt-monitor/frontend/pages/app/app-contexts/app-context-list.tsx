import { Fragment } from 'react'
import { BlocksIcon, BoxIcon } from 'lucide-react'
import { Box, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-kit-react-ui/box'
import { Counter } from 'newt-kit-react-ui/counter'
import { Icon } from 'newt-kit-react-ui/icon'
import { TextLink } from 'newt-kit-react-ui/link'
import { Inline } from 'newt-kit-react-ui/inline'
import { Stack } from 'newt-kit-react-ui/stack'
import type { ApplicationDescription } from '../../../api/structure'
import { AppRemovedRow, AppRemovedToggle, useRemoved } from '../app-removed/app-removed'
import { contextHref, moduleHref } from '../app-structure'

/** Every context, each with its modules. */
export function AppContextList({ appId, description }: { appId: string, description: ApplicationDescription }) {
  const removed = useRemoved()
  const gone = (context: string) => removed.filter(item => item.kind === 'module' && item.context === context)
  const goneContexts = removed.filter(item => item.kind === 'context')

  return (
    <Stack gap={4}>
      <Inline justify="end"><AppRemovedToggle /></Inline>
      {description.contexts.map(context => (
        <Box key={context.name} label={context.name}>
          <BoxHeader actions={context.uses.length ? <>uses {context.uses.map((used, index) => <Fragment key={used}>{index > 0 && ', '}<TextLink href={contextHref(appId, used)}>{used}</TextLink></Fragment>)}</> : undefined}>
            <Icon icon={BlocksIcon} tone="muted" /> <TextLink href={contextHref(appId, context.name)}>{context.name}</TextLink> <Counter>{context.modules.length}</Counter>
          </BoxHeader>
          {context.modules.map(module => (
            <BoxRow key={module.id} leading={<Icon icon={BoxIcon} tone="muted" />}>
              <BoxRowTitle href={moduleHref(appId, module.id)}>{module.name}</BoxRowTitle>
              <BoxRowMeta>
                <>{module.useCases.length} use cases</>
                <>{module.events.length} events</>
                <>{module.deps.length} deps</>
              </BoxRowMeta>
            </BoxRow>
          ))}
          {gone(context.name).map(item => <AppRemovedRow key={item.id} item={item} href={moduleHref(appId, item.itemId)} />)}
        </Box>
      ))}
      {goneContexts.length > 0 && (
        <Box label="Removed contexts">
          <BoxHeader>Removed contexts <Counter>{goneContexts.length}</Counter></BoxHeader>
          {goneContexts.map(item => <AppRemovedRow key={item.id} item={item} href={contextHref(appId, item.itemId)} />)}
        </Box>
      )}
    </Stack>
  )
}
