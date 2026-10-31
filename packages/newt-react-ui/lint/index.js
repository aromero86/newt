import tseslint from 'typescript-eslint'

const STYLING = 'An app does not style: compose components of newt-react-ui, or make one in the app\'s own components folder.'
const ELEMENT = 'A page is made of components: use one of newt-react-ui, or make one in the app\'s own components folder.'
const PRIMITIVES = 'Build on newt-react-ui\'s components: its primitives (Radix, Recharts, its shadcn pieces) are its own, or the app components folder\'s.'
const STYLING_TOOLS = 'Class names are made in the app\'s components folder only.'

/** HTML elements a page may write as they are: none of them is ever styled. */
const ELEMENTS = ['form', 'fieldset']

/**
 * The imports newt-react-ui's lint refuses outside an app's components folder: the
 * primitives, the library's internals and the tools that make class names. A config
 * that sets `no-restricted-imports` again for an app's files spreads them before its
 * own, so it adds to the library's restrictions instead of replacing them.
 */
export const RESTRICTED_IMPORTS = [
  { group: ['radix-ui', '@radix-ui/*', 'recharts', 'recharts/*'], message: PRIMITIVES },
  { group: ['newt-react-ui/internal', 'newt-react-ui/internal/*', '**/newt-react-ui/internal/**'], message: PRIMITIVES },
  { group: ['cn', 'class-variance-authority', 'tailwind-merge', 'clsx'], message: STYLING_TOOLS },
]

/**
 * newt-react-ui's lint, for a React app that uses it. Its pages, and everything that is
 * not in its own components folder (`components`):
 *
 * - style nothing: no `className`, `class`, `style`, `class:`/`style:` attributes, and
 *   no `<style>`, nor the tools that make class names (`cn`, `class-variance-authority`,
 *   `tailwind-merge`);
 * - write no HTML element but `form` and `fieldset` (or those `elements` allows):
 *   a page is made of components;
 * - import no primitive the library builds on: Radix, its shadcn pieces.
 *
 * In the app's components folder all of that is allowed: there an app wraps the
 * library's components, or makes its own. Nowhere else.
 *
 * ```js
 * import { newtReactUi } from 'newt-react-ui/lint'
 * export default [
 *   ...newtReactUi({ files: ['web/**\/*.{ts,tsx}'], components: ['web/components/**'] }),
 * ]
 * ```
 *
 * It sets `no-restricted-syntax` and `no-restricted-imports` for those files: a config
 * after it that sets them for the same files replaces its own, so put yours in
 * `syntax` and `imports`, or spread `RESTRICTED_IMPORTS` before your own patterns.
 */
export function newtReactUi({ files, components = [], elements = ELEMENTS, syntax = [], imports = [] }) {
  if (!files?.length) throw new Error('newtReactUi: say which files are the app\'s (`files`)')
  // `<style>` is the styling rule's; the rest, the elements an app may write.
  const allowed = ['style', ...elements].map(name => `^${name}$`).join('|')
  // ESLint lints a file only when a pattern names it, not one that ends in `/**`.
  const componentFiles = components.map(glob => (glob.endsWith('/**') ? `${glob}/*.{js,jsx,ts,tsx}` : glob))
  return [
    {
      files,
      ignores: components,
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: {
        'no-restricted-syntax': ['error',
          { selector: 'JSXAttribute[name.name=/^(className|class|style)$/]', message: STYLING },
          { selector: 'JSXAttribute > JSXNamespacedName[namespace.name=/^(class|style)$/]', message: STYLING },
          { selector: 'JSXOpeningElement[name.name="style"]', message: STYLING },
          { selector: `JSXOpeningElement > JSXIdentifier.name[name=/^[a-z]/]:not([name=/${allowed}/])`, message: ELEMENT },
          ...syntax,
        ],
        'no-restricted-imports': ['error', {
          patterns: [
            ...RESTRICTED_IMPORTS,
            ...imports,
          ],
        }],
      },
    },
    // An app with no components of its own has nothing more to say.
    ...(componentFiles.length === 0 ? [] : [{
      files: componentFiles,
      languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      rules: {
        // The app's components build on the library's, and on its primitives if they must: never on its internals.
        'no-restricted-imports': ['error', {
          patterns: [
            { group: ['newt-react-ui/internal', 'newt-react-ui/internal/*', '**/newt-react-ui/internal/**'], message: PRIMITIVES },
            ...imports,
          ],
        }],
      },
    }]),
  ]
}
