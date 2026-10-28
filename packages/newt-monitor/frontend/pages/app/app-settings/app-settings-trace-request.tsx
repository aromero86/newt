import { useState } from 'react'
import { CopyIcon, PinIcon } from 'lucide-react'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxBody, BoxHeader } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { CodeBlock } from 'newt-react-ui/code-block'
import { Icon } from 'newt-react-ui/icon'
import { Inline } from 'newt-react-ui/inline'
import { RelativeTime } from 'newt-react-ui/relative-time'
import { Select } from 'newt-react-ui/select'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Text } from 'newt-react-ui/text'
import { toast } from 'newt-react-ui/toast'
import { useService } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { TracesApi, type TraceHeaderDTO } from '../../../api/traces'

const HOURS = [1, 6, 24]

/**
 * Settings' Trace a request: the header that keeps whole the trace of every request
 * carrying it, whatever its share, for a while. Signed with the application's key, which
 * it checks: to look at a request in production.
 */
export function AppSettingsTraceRequest({ app }: { app: AppDTO }) {
  const api = useService(TracesApi)
  const [hours, setHours] = useState(1)
  const [header, setHeader] = useState<TraceHeaderDTO | null>(null)
  const [making, setMaking] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const line = header ? `${header.name}: ${header.value}` : ''

  async function make() {
    setMaking(true)
    setFailure(null)
    try {
      setHeader(await api.header(app.id, hours))
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setMaking(false)
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  }

  return (
    <Stack gap={4}>
      <Subhead
        title="Trace a request"
        description="Every request that carries this header has its trace kept whole, whatever share of traces the application keeps, until the header ends. Whoever has it can ask for traces until then, and no longer: it is signed with the application's key."
      />
      {failure && <Alert tone="bad" title="Could not make a header">{failure}</Alert>}
      <Inline gap={2} wrap>
        <Select size="compact" label="Good for" value={String(hours)} onValueChange={value => setHours(Number(value))} options={HOURS.map(each => ({ value: String(each), label: each === 1 ? 'For an hour' : `For ${each} hours` }))} />
        <Button loading={making} onClick={() => void make()}><Icon icon={PinIcon} size="sm" />Make a header</Button>
      </Inline>
      {header && (
        <Box label="The header">
          <BoxHeader actions={<Button size="sm" variant="outline" onClick={() => void copy(line)}><Icon icon={CopyIcon} size="sm" />Copy</Button>}>
            The header: it ends <RelativeTime date={header.expiresAt} />
          </BoxHeader>
          <BoxBody>
            <Stack gap={3}>
              <CodeBlock label="The header">{line}</CodeBlock>
              <Text size="sm" tone="muted">With curl, to the application's own address:</Text>
              <CodeBlock label="With curl">{`curl -H '${line}' https://…`}</CodeBlock>
              <Text size="sm" tone="muted">Its traces are in Traces, under “Asked for”.</Text>
            </Stack>
          </BoxBody>
        </Box>
      )}
    </Stack>
  )
}
