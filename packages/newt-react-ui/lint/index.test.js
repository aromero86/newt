import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ESLint } from 'eslint'
import { newtReactUi, RESTRICTED_IMPORTS } from './index.js'

let root
let eslint

/** Lints one file of an app, and says what each complaint is about. */
async function complaints(path, code) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), code)
  const [result] = await eslint.lintFiles([join(root, path)])
  return result.messages.map(each => [STYLES, ELEMENT, PRIMITIVE, TOOLS].find(said => each.message.includes(said)) ?? each.message)
}

const STYLES = 'An app does not style'
const ELEMENT = 'A page is made of components'
const PRIMITIVE = 'Build on newt-react-ui\'s components'
const TOOLS = 'Class names are made in the app\'s components folder only'

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'newt-react-ui-lint-'))
  eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: newtReactUi({ files: ['web/**/*.{ts,tsx}'], components: ['web/components/**'] }) })
})

afterAll(() => rm(root, { recursive: true, force: true }))

describe("newt-react-ui's lint", () => {
  test('lets a page compose the library\'s components, and its own', async () => {
    const page = "import { Button } from 'newt-react-ui/button'\nimport { AppCard } from '../components/app-card'\nexport const Page = () => <form><AppCard /><Button>Save</Button></form>\n"

    expect(await complaints('web/pages/apps.tsx', page)).toEqual([])
  })

  test('refuses a page that styles: classes, styles, a <style>', async () => {
    expect(await complaints('web/pages/a.tsx', 'export const A = () => <Card className="mt-4" />\n')).toEqual([STYLES])
    expect(await complaints('web/pages/b.tsx', 'export const B = () => <Card style={{ margin: 4 }} />\n')).toEqual([STYLES])
    expect(await complaints('web/pages/c.tsx', 'export const C = () => <style>{"a {}"}</style>\n')).toEqual([STYLES])
    // Nor through an object spread onto a component.
    expect(await complaints('web/pages/s.tsx', "export const S = () => <Button {...{ className: 'x' }} />\n")).toEqual([STYLES])
    expect(await complaints('web/pages/t.tsx', "export const T = () => <Button {...{ 'style': { margin: 4 } }} />\n")).toEqual([STYLES])
  })

  test('refuses an HTML element in a page: it is made of components', async () => {
    expect(await complaints('web/pages/d.tsx', 'export const D = () => <div><Text>Hi</Text></div>\n')).toEqual([ELEMENT])
    expect(await complaints('web/pages/e.tsx', 'export const E = () => <span>Hi</span>\n')).toEqual([ELEMENT])
  })

  test('refuses the primitives and the tools that make classes, outside the app\'s components', async () => {
    expect(await complaints('web/pages/f.tsx', "import { Dialog } from 'radix-ui'\nexport const F = Dialog\n")).toEqual([PRIMITIVE])
    expect(await complaints('web/pages/g.tsx', "import { Button } from 'newt-react-ui/internal/button'\nexport const G = Button\n")).toEqual([PRIMITIVE])
    expect(await complaints('web/pages/h.tsx', "import { cn } from 'cn'\nexport const H = cn\n")).toEqual([TOOLS])
  })

  test('lets the app\'s components wrap the library, style, and use a primitive; never its internals', async () => {
    const wrapper = "import { Popover } from 'radix-ui'\nimport { cn } from 'cn'\nexport const AppCard = () => <div className={cn('rounded-lg border')}><Popover.Root /></div>\n"

    expect(await complaints('web/components/app-card.tsx', wrapper)).toEqual([])
    expect(await complaints('web/components/x.tsx', "import { Button } from 'newt-react-ui/internal/button'\nexport const X = Button\n")).toEqual([PRIMITIVE])
  })

  test('takes the elements an app allows, and asks which files are the app\'s', () => {
    const configs = newtReactUi({ files: ['web/**'], elements: ['form', 'output'] })

    expect(JSON.stringify(configs[0].rules['no-restricted-syntax'])).toContain('^style$|^form$|^output$')
    expect(() => newtReactUi({})).toThrow('which files')
    // An app with no components of its own: the pages' rules only.
    expect(newtReactUi({ files: ['web/**'] })).toHaveLength(1)
  })

  test('exports the imports it refuses, so a config that sets them again keeps them', () => {
    const [pages] = newtReactUi({ files: ['web/**'], imports: [{ regex: 'mine', message: 'Mine.' }] })
    const [, { patterns }] = pages.rules['no-restricted-imports']

    expect(RESTRICTED_IMPORTS.length).toBeGreaterThan(0)
    expect(patterns).toEqual([...RESTRICTED_IMPORTS, { regex: 'mine', message: 'Mine.' }])
  })
})
