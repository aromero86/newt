import { join, resolve } from 'node:path'
import { KEBAB, moduleNames } from './module-names'
import { moduleTemplates } from './module-templates'
import { writeNew } from './write-new'

/**
 * Writes a module's skeleton in `<context>/modules/<name>/`, with the anatomy newt's
 * lint keeps and names derived from the folder's (`price-change` → `PriceChange_Module`,
 * `price-change.schema.ts`, table `price_change`). Never overwrites a file.
 */
export async function addModule(cwd: string, context: string, name: string): Promise<string[]> {
  if (!KEBAB.test(name)) throw new Error(`'${name}' is not a module's folder name: lower-case words in kebab case, as price-change`)
  const names = moduleNames(name)
  const folder = join(context, 'modules', name)
  const { written, skipped } = await writeNew(resolve(cwd, folder), moduleTemplates(names))
  return [
    ...written.map(path => `wrote    ${join(folder, path)}`),
    ...skipped.map(path => `skipped  ${join(folder, path)} (it is there already: left as it was)`),
    '',
    'Next:',
    `  decide the scope in ${join(folder, `${name}.repository.ts`)}: a tenant's { field, current }, or 'none' with the reason`,
    `  add a migration for the table '${names.table}' in each dialect's migrations folder (FileStore needs none)`,
    `  initialize ${names.entity}_Module in the context, after the modules it uses, with its deps`,
    '  bun check && bun test && bunx eslint',
  ]
}
