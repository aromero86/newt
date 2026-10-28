import { CircleAlertIcon, CircleXIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from 'newt-react-ui/box'
import { Icon } from 'newt-react-ui/icon'
import { Mono, Text } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import { changeOf } from '../app-metrics/metrics-format'
import { AppUseCaseService } from './app-use-case.service'

/** How a use case's calls ended badly, by code, beside the window before. */
export function AppUseCaseErrors() {
  const service = useService(AppUseCaseService)
  const errors = useValue(service.errors)
  const codes = useValue(service.codes)
  if (!errors) return null

  return (
    <Box label="By code">
      <BoxHeader>By code, beside the window before</BoxHeader>
      {codes.length === 0 && <BoxEmpty icon={CircleAlertIcon} title="None ended badly" description="Not in this window, nor in the one before." />}
      {codes.map(code => {
        const change = changeOf(code.count, code.previous)
        return (
          <BoxRow
            key={`${code.kind}|${code.code}`}
            leading={<Icon icon={code.kind === 'failure' ? CircleXIcon : CircleAlertIcon} tone={code.kind === 'failure' ? 'bad' : 'warn'} />}
            trailing={<Text size="sm" tone="muted">{code.count.toLocaleString('en')}</Text>}
          >
            <Mono>{code.code}</Mono> <Badge tone={code.kind === 'failure' ? 'bad' : 'warn'}>{code.kind === 'failure' ? 'Failure' : 'Error'}</Badge>
            <BoxRowMeta>
              <>{code.previous.toLocaleString('en')} the window before{change ? ` (${change})` : ''}</>
              <>{code.kind === 'failure' ? 'nobody expected it' : 'it says it may happen'}</>
            </BoxRowMeta>
          </BoxRow>
        )
      })}
    </Box>
  )
}
