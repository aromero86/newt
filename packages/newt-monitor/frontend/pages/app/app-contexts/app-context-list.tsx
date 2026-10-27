import { Fragment } from 'react'
import { BlocksIcon, BoxIcon } from 'lucide-react'
import { Box, BoxHeader, BoxRow, BoxRowMeta, BoxRowTitle } from 'newt-react-ui/box'
import { Counter } from 'newt-react-ui/counter'
import { Icon } from 'newt-react-ui/icon'
import { TextLink } from 'newt-react-ui/link'
import { Stack } from 'newt-react-ui/stack'
import type { ApplicationDescription } from '../../../api/structure'
import { contextHref, moduleHref } from '../app-structure'

/** Every context, each with its modules. */
export function AppContextList({ appId, description }: { appId: string, description: ApplicationDescription }) {
  return (
    <Stack gap={4}>
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
        </Box>
      ))}
    </Stack>
  )
}
