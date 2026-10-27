import { CircleAlertIcon, CircleXIcon } from 'lucide-react'
import { Badge } from 'newt-react-ui/badge'
import { Box, BoxEmpty, BoxHeader, BoxRow, BoxRowMeta } from 'newt-react-ui/box'
import { Icon } from 'newt-react-ui/icon'
import { LineChart } from 'newt-react-ui/line-chart'
import { Mono, Text } from 'newt-react-ui/text'
import { useService, useValue } from 'newt-react'
import { BUCKET_LABELS, changeOf, timeFormat } from '../app-metrics/metrics-format'
import { AppUseCaseService } from './app-use-case.service'

/** How a use case's calls ended badly: over time, errors and failures, and by code beside the window before. */
export function AppUseCaseErrors({ useCase }: { useCase: string }) {
  const service = useService(AppUseCaseService)
  const errors = useValue(service.errors)
  const codes = useValue(service.codes)
  const window = useValue(service.window)
  const bucket = useValue(service.bucket)
  if (!errors) return null
  const format = timeFormat(window, bucket)

  return (
    <>
      <Box label="How its calls ended badly">
        <BoxHeader>How its calls ended badly, every {BUCKET_LABELS[bucket]}</BoxHeader>
        <BoxRow>
          <LineChart
            label={`${useCase}: errors and failures, every ${BUCKET_LABELS[bucket]}`}
            times={errors.points.map(point => point.at)}
            formatTime={format}
            series={[
              { key: 'errors', label: 'Errors', tone: 'warn', values: errors.points.map(point => point.errors) },
              { key: 'failures', label: 'Failures', tone: 'bad', values: errors.points.map(point => point.failures) },
            ]}
          />
        </BoxRow>
      </Box>
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
    </>
  )
}
