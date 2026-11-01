import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { z } from 'zod'
import { FormStore } from '../form/form-store'
import { FormField } from './form-field'

const AppSchema = z.object({ name: z.string().min(1, 'Say a name'), url: z.url('An address'), kind: z.enum(['app', 'site']) })
const form = () => new FormStore(AppSchema, { name: '', url: 'http://cooper:3010', kind: 'app' })

describe('FormField', () => {
  test('shows a value of its form, in newt-kit-react-ui\'s field, by name', () => {
    const html = renderToStaticMarkup(<FormField form={form()} name="url" label="Address" />)

    expect(html).toContain('>Address</label>')
    expect(html).toContain('value="http://cooper:3010"')
    expect(html).toContain('name="url"')
  })

  test('shows the error its form found for it, and marks it invalid', async () => {
    const app = form()
    await app.submit(async () => {})

    const html = renderToStaticMarkup(<FormField form={app} name="name" label="Name" />)
    expect(html).toContain('Say a name')
    expect(html).toContain('aria-invalid="true"')
  })

  test('is a textarea with rows, and a choice with options', () => {
    expect(renderToStaticMarkup(<FormField form={form()} name="name" label="Notes" rows={3} />)).toContain('<textarea')
    expect(renderToStaticMarkup(<FormField form={form()} name="kind" label="Kind" options={[{ value: 'app', label: 'App' }, { value: 'site', label: 'Site' }]} />)).toContain('role="combobox"')
  })
})
