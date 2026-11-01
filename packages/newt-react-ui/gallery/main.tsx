import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert } from '../components/alert'
import { AppShell } from '../components/app-shell'
import { Badge } from '../components/badge'
import { Counter } from '../components/counter'
import { Graph } from '../components/graph'
import { TimeSeries } from '../components/time-series'
import { Button } from '../components/button'
import { Card } from '../components/card'
import { Checkbox } from '../components/checkbox'
import { ConfirmDialog } from '../components/confirm-dialog'
import { EmptyState } from '../components/empty-state'
import { Field } from '../components/field'
import { Grid } from '../components/grid'
import { Heading } from '../components/heading'
import { Inline } from '../components/inline'
import { Input } from '../components/input'
import { PageBody } from '../components/page-body'
import { PageHeader } from '../components/page-header'
import { RelativeTime } from '../components/relative-time'
import { Select } from '../components/select'
import { Skeleton } from '../components/skeleton'
import { Spinner } from '../components/spinner'
import { Stack } from '../components/stack'
import { Stat } from '../components/stat'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs'
import { Text } from '../components/text'
import { Toaster, toast } from '../components/toast'

/**
 * newt-kit-react-ui's components, each as an app would use it: `bun run ui`. It follows
 * the library's own rule: no class, no style, only components.
 */
function Gallery() {
  const [dark, setDark] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<string | undefined>('useCase')
  const [watched, setWatched] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const switchTheme = () => {
    document.documentElement.classList.toggle('dark', !dark)
    setDark(!dark)
  }
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  return (
    <AppShell brand={<Text weight="semibold">newt-kit-react-ui</Text>} actions={<Button variant="ghost" onClick={switchTheme}>{dark ? 'Light' : 'Dark'}</Button>}>
      <PageBody>
        <Stack gap={8}>
          <PageHeader title="Components" description="What a newt app's pages are made of: they compose these, and style nothing." />

          <Card title="Actions and states">
            <Stack gap={4}>
              <Inline gap={2} wrap>
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive" onClick={() => setConfirming(true)}>Delete</Button>
                <Button loading>Saving</Button>
                <Button variant="link" href="#">A link</Button>
              </Inline>
              <Inline gap={2} wrap>
                <Badge tone="ok">up</Badge>
                <Badge tone="bad">down</Badge>
                <Badge tone="warn">archived</Badge>
                <Badge tone="info">changed</Badge>
                <Badge tone="muted">unknown</Badge>
                <Counter>145</Counter>
                <Spinner />
              </Inline>
              <Alert tone="ok" title="cooper answers">Its structure was read an hour ago.</Alert>
              <Alert tone="bad" title="nuke does not answer">The key is not the application's.</Alert>
            </Stack>
          </Card>

          <Card title="A form">
            <Stack gap={4}>
              <Field label="Name" description="As the monitor shows it" error={name.trim() === '' ? 'Say a name' : undefined}>
                <Input value={name} onChange={setName} />
              </Field>
              <Field label="Kind">
                <Select value={kind} onValueChange={setKind} options={[{ value: 'useCase', label: 'Use case' }, { value: 'event', label: 'Event' }]} />
              </Field>
              <Checkbox checked={watched} onCheckedChange={setWatched} label="Watched" />
              <Inline>
                <Button onClick={() => toast.success('Saved', { description: 'cooper is registered' })}>Save</Button>
              </Inline>
            </Stack>
          </Card>

          <Grid columns={{ base: 1, md: 3 }}>
            <Stat label="Applications" value={3} />
            <Stat label="Use cases" value={145} hint="in cooper" />
            <Stat label="Versions" value={12} />
          </Grid>

          <Card title="Data">
            <Tabs defaultValue="table">
              <TabsList label="Views">
                <TabsTrigger value="table" count={2}>Table</TabsTrigger>
                <TabsTrigger value="empty">Empty</TabsTrigger>
                <TabsTrigger value="loading">Loading</TabsTrigger>
              </TabsList>
              <TabsContent value="table">
                <Table caption="Applications">
                  <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Read</TableHead></TableRow></TableHeader>
                  <TableBody>
                    <TableRow><TableCell>cooper</TableCell><TableCell><Badge tone="ok">up</Badge></TableCell><TableCell><RelativeTime date={hourAgo} /></TableCell></TableRow>
                    <TableRow><TableCell>nuke</TableCell><TableCell><Badge tone="bad">down</Badge></TableCell><TableCell><RelativeTime date={hourAgo} /></TableCell></TableRow>
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="empty">
                <EmptyState title="No applications" description="Register the first one" action={<Button>Register</Button>} />
              </TabsContent>
              <TabsContent value="loading">
                <Stack gap={2}><Skeleton /><Skeleton /><Skeleton /></Stack>
              </TabsContent>
            </Tabs>
          </Card>

          <Card title="A time series">
            <TimeSeries
              label="card.created, last 24 hours"
              names={{ points: 'Last 24 hours', compared: 'The day before' }}
              formatTime={at => new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
              points={Array.from({ length: 96 }, (_, index) => ({ at: new Date(Date.UTC(2026, 0, 1) + index * 15 * 60_000).toISOString(), count: Math.round(20 + 15 * Math.sin(index / 8) + (index % 7)) }))}
              compared={Array.from({ length: 96 }, (_, index) => ({ at: new Date(Date.UTC(2026, 0, 1) + index * 15 * 60_000).toISOString(), count: Math.round(18 + 12 * Math.sin(index / 8 + 0.6)) }))}
            />
          </Card>

          <Card title="A graph">
            <Graph
              label="cooper's contexts"
              nodes={[{ id: 'auth', label: 'auth', href: '#auth' }, { id: 'boards', label: 'boards', href: '#boards', emphasis: true }, { id: 'backoffice', label: 'backoffice', href: '#backoffice' }]}
              edges={[{ from: 'boards', to: 'auth' }, { from: 'backoffice', to: 'auth' }, { from: 'backoffice', to: 'boards', dashed: true }]}
            />
          </Card>

          <Heading level={2}>That is all</Heading>
        </Stack>
      </PageBody>
      <ConfirmDialog open={confirming} onOpenChange={setConfirming} title="Delete cooper?" description="Everything the monitor knows of it goes." confirmLabel="Delete" tone="destructive" onConfirm={() => setConfirming(false)} />
      <Toaster />
    </AppShell>
  )
}

createRoot(document.getElementById('root')!).render(<Gallery />)
