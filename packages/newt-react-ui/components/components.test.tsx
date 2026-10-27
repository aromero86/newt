import { describe, expect, test } from 'bun:test'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Alert } from './alert'
import { Badge } from './badge'
import { Counter } from './counter'
import { BoxRowMeta } from './box'
import { Button } from './button'
import { EmptyState } from './empty-state'
import { Field } from './field'
import { Input } from './input'
import { LinkProvider, TextLink, type LinkComponent } from './link'
import { Graph } from './graph'
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
