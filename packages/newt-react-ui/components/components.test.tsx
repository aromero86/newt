import { describe, expect, test } from 'bun:test'
import { PlayIcon } from 'lucide-react'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Alert } from './alert'
import { Badge } from './badge'
import { CodeBlock } from './code-block'
import { Counter } from './counter'
import { BoxRowMeta } from './box'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { Field } from './field'
import { Input } from './input'
import { LinkProvider, TextLink, type LinkComponent } from './link'
import { Graph } from './graph'
import { ChartPanel, ChartRow } from './chart-panel'
import { LineChart } from './line-chart'
import { TimeSeries } from './time-series'
import { Waterfall } from './waterfall'
import { RelativeTime } from './relative-time'
import { SideNav, SideNavItem } from './side-nav'
import { Stack } from './stack'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'

/** What a component renders, as HTML: enough to see its markup, its classes and its roles, with no browser. */
const html = (element: ReactElement) => renderToStaticMarkup(element)

/** An app router's link, as an app gives it: it marks what it renders. */
const RouterLink: LinkComponent = ({ href, children, ...rest }) => <a data-router="" href={href} {...rest}>{children}</a>

describe('newt-react-ui', () => {
  test('a button is a button, or a link with `href`, through the app\'s link', () => {
    expect(html(<Button>Save</Button>)).toMatch(/^<button[^>]*type="button"/)
    expect(html(<Button type="submit">Save</Button>)).toContain('type="submit"')
    expect(html(<LinkProvider component={RouterLink}><Button href="/apps">Apps</Button></LinkProvider>)).toMatch(/^<a data-router="" href="\/apps"/)
  })

  test('a button loading shows a spinner, and cannot be pressed until it is done', () => {
    const loading = html(<Button loading>Save</Button>)

    expect(loading).toContain('disabled=""')
    expect(loading).toContain('aria-busy="true"')
    expect(loading).toContain('animate-spin')
  })

  test('a time series is a figure named for screen readers, coloured by the theme', () => {
    const points = [{ at: '2026-01-01T10:00:00Z', count: 3 }, { at: '2026-01-01T10:05:00Z', count: 1 }]
    // Recharts draws once it is measured, in the browser: here, its frame.
    const chart = html(<TimeSeries label="card.created" points={points} compared={points.map(point => ({ ...point, count: 2 }))} />)

    expect(chart).toContain('aria-label="card.created"')
    expect(chart).toContain('--color-now:var(--brand)')
  })

  test('a line chart colours each line by its tone', () => {
    const chart = html(<LineChart label="card.create latency" times={['2026-01-01T10:00:00Z']} series={[{ key: 'p50', label: 'p50', tone: 'ok', values: [12] }, { key: 'p99', label: 'p99', tone: 'bad', values: [null] }]} />)

    expect(chart).toContain('aria-label="card.create latency"')
    expect(chart).toContain('--color-p50:var(--ok)')
    expect(chart).toContain('--color-p99:var(--bad)')
  })

  test('a line chart\'s legend shows or hides each line, and a line of another unit reads on a right axis', () => {
    const chart = html(<LineChart label="Use cases" times={['2026-01-01T10:00:00Z']} series={[{ key: 'calls', label: 'Calls', tone: 'brand', values: [12] }, { key: 'mean', label: 'Mean', tone: 'muted', axis: 'right', values: [40] }]} />)

    expect(chart.match(/aria-pressed="true"/g)).toHaveLength(2)
    expect(chart).toContain('Mean (right)')
  })

  test('charts side by side, each in its box with a button that zooms it, and not drawn twice until zoomed', () => {
    const series = [{ key: 'p50', label: 'p50', tone: 'ok' as const, values: [12] }]
    const row = html(<ChartRow><ChartPanel title="How long"><LineChart label="Latency" times={['2026-01-01T10:00:00Z']} series={series} /></ChartPanel><ChartPanel title="Calls"><LineChart label="Calls" times={['2026-01-01T10:00:00Z']} series={series} /></ChartPanel></ChartRow>)

    expect(row).toContain('md:grid-cols-2')
    expect(row.match(/aria-label="Zoom"/g)).toHaveLength(2)
    expect(row.match(/<figure/g)).toHaveLength(2)
  })

  test('a waterfall is a list of steps, each a bar where and as long as it ran, pressed to select it', () => {
    const rows = [{ id: '1', depth: 0, label: 'POST /cards', startMs: 0, ms: 100 }, { id: '2', depth: 1, label: 'card.create', startMs: 50, ms: 25, tone: 'bad' as const }]
    const waterfall = html(<Waterfall label="Trace" rows={rows} selected="2" onSelect={() => {}} />)

    expect(waterfall).toContain('aria-label="Trace"')
    expect(waterfall).toContain('padding-left:16px')
    expect(waterfall).toContain('left:50%;width:max(2px, 25%)')
    expect(waterfall).toContain('bg-bad')
    expect(waterfall).toContain('aria-pressed="true"')
  })

  test('a waterfall marks a moment, dots a wait, unfolds a row and links where it is whole', () => {
    const rows = [
      { id: 'e', depth: 1, label: 'card.created', startMs: 10, ms: 0, instant: true },
      { id: 'j', depth: 2, label: 'card.index.on.card.created', startMs: 60, ms: 40, waitFromMs: 10, expandable: { expanded: false, onToggle: () => {}, label: 'Show its steps' }, link: { href: '/traces/j', label: 'Open' } },
    ]
    const waterfall = html(<Waterfall label="Flow" rows={rows} />)

    expect(waterfall).toContain('rotate-45')
    expect(waterfall).toContain('border-dashed')
    expect(waterfall).toContain('aria-expanded="false"')
    expect(waterfall).toContain('href="/traces/j"')
    expect(html(<Waterfall label="Steps" rows={[{ id: 'u', depth: 0, label: 'card.create', startMs: 0, ms: 5, icon: PlayIcon }]} />)).toContain('lucide-play')
  })

  test('a waterfall\'s marks are dots on their row\'s line, each named by what it says', () => {
    const rows = [{ id: 'u', depth: 0, label: 'card.create', startMs: 0, ms: 10, marks: [{ id: 'l1', atMs: 5, tone: 'bad' as const, label: 'error: the provider did not answer' }] }]
    const waterfall = html(<Waterfall label="Steps" rows={rows} />)

    expect(waterfall).toContain('aria-label="error: the provider did not answer"')
    expect(waterfall).toContain('left:50%')
    expect(waterfall).toContain('rounded-full')
  })

  test('a graph draws its nodes as links, and an arrow for each use', () => {
    const graph = html(<Graph label="Contexts" nodes={[{ id: 'auth', label: 'auth', href: '/auth' }, { id: 'boards', label: 'boards' }]} edges={[{ from: 'boards', to: 'auth' }]} />)

    expect(graph).toContain('aria-label="Contexts"')
    expect(graph).toContain('href="/auth"')
    expect(graph.match(/<path d="M \d/g)).toHaveLength(1)
  })

  test('a side menu\'s item inside another one is indented under it', () => {
    const menu = html(<SideNav label="Contexts"><SideNavItem href="/boards">boards</SideNavItem><SideNavItem href="/boards/card" level={1}>card</SideNavItem></SideNav>)

    expect(menu).toMatch(/href="\/boards"[^>]*pl-3/)
    expect(menu).toMatch(/href="\/boards\/card"[^>]*pl-8/)
  })

  test('a button with only an icon has the name it is given', () => {
    expect(html(<Button size="icon" label="Refresh">↻</Button>)).toContain('aria-label="Refresh"')
  })

  test('every link of the library goes through the app\'s link, a plain one by default', () => {
    expect(html(<TextLink href="/a">A</TextLink>)).toMatch(/^<a href="\/a"/)
    expect(html(<LinkProvider component={RouterLink}><TextLink href="/a">A</TextLink></LinkProvider>)).toContain('data-router=""')
  })

  test('a field ties its label, its help and its error to its control', () => {
    const field = html(<Field label="Name" description="As people see it" error="Taken"><Input value="" onChange={() => {}} /></Field>)

    const controlId = /<input[^>]* id="([^"]+)"/.exec(field)![1]
    expect(field).toContain(`for="${controlId}"`)
    expect(field).toContain('aria-invalid="true"')
    const describedBy = /aria-describedby="([^"]+)"/.exec(field)![1]!.split(' ')
    expect(describedBy).toHaveLength(2)
    for (const id of describedBy) expect(field).toContain(`id="${id}"`)
  })

  test('an alert is a status, or an alert when something is wrong', () => {
    expect(html(<Alert tone="ok" title="Saved" />)).toContain('role="status"')
    expect(html(<Alert tone="bad" title="Failed" />)).toContain('role="alert"')
  })

  test('tones and spaces are the library\'s, by name', () => {
    expect(html(<Badge tone="ok">up</Badge>)).toContain('text-ok')
    expect(html(<Counter>145</Counter>)).toContain('>145<')
    expect(html(<Stack gap={2}><span /></Stack>)).toContain('gap-2')
  })

  test('a code block keeps its lines as they were written', () => {
    expect(html(<CodeBlock label="Stack">{'TypeError: x\n    at f (a.ts:1)'}</CodeBlock>)).toMatch(/^<pre role="region" aria-label="Stack" tabindex="0"[^>]*whitespace-pre[^>]*>TypeError: x\n {4}at f/)
  })

  test('an empty state says what is missing, and offers what to do', () => {
    const empty = html(<EmptyState title="No applications" description="Register the first one" action={<Button>Register</Button>} />)

    expect(empty).toContain('No applications')
    expect(empty).toContain('<button')
  })

  test('a time says how long ago, and the exact time for machines', () => {
    const at = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()

    expect(html(<RelativeTime date={at} />)).toContain(`dateTime="${at}"`)
    expect(html(<RelativeTime date={at} />)).toContain('2 days ago')
  })

  test('a table has its header cells as headers', () => {
    const table = html(
      <Table caption="Applications">
        <TableHeader><TableRow><TableHead>Name</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>cooper</TableCell></TableRow></TableBody>
      </Table>,
    )

    expect(table).toContain('<caption')
    expect(table).toMatch(/<th[^>]*scope="col"[^>]*>Name<\/th>/)
  })

  test('a row\'s meta puts a dot between its parts, and none for a part that is not there', () => {
    const meta = html(<BoxRowMeta>{'ana@acme.test'}{false}<>signed up</></BoxRowMeta>)

    expect(meta.match(/<span>/g)).toHaveLength(2)
    expect(meta).toContain('<span aria-hidden="true">·</span>')
    expect(meta).toContain('<span>ana@acme.test</span>')
  })
})
