import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'

// Apps build their UI from @newt/ui only. Styling lives in src/libs/ui and in
// each app's own ui/ folder; everywhere else, class names and inline styles are
// forbidden, and so is reaching past @newt/ui into shadcn or Radix.

const APPS = ['src/frontend/**/*.{ts,tsx}', 'src/landing/**/*.{ts,tsx,astro}']
const APP_UI = ['src/frontend/ui/**', 'src/landing/ui/**']

const STYLING_MESSAGE = 'Apps do not style: use a component from @newt/ui or from this app\'s ui/ folder.'

const UI_IMPORTS = [
  { group: ['radix-ui', '@radix-ui/*'], message: 'Use a component from @newt/ui instead.' },
  { group: ['@newt/ui/shadcn', '@newt/ui/shadcn/*', '**/libs/ui/shadcn/**'], message: 'shadcn is private to @newt/ui: use @newt/ui/components/*.' },
]

// The frontend shares the backend's contract, never its code: a module's schema
// file is the only thing it may import from the backend.
const BACKEND_IMPORTS = {
  regex: '/backend/(?!modules/[^/]+/[^/]+\\.schema$)',
  message: 'The frontend may only import a backend module\'s *.schema.ts (its contract).',
}

export default tseslint.config(
  { ignores: ['dist/**', '**/.astro/**', '**/node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
  },
  ...astro.configs['flat/base'],
  {
    files: ['src/landing/**/*.{ts,tsx,astro}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: UI_IMPORTS }],
    },
  },
  {
    files: ['src/frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, BACKEND_IMPORTS] }],
    },
  },
  {
    files: APPS,
    ignores: APP_UI,
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'JSXAttribute[name.name=/^(className|class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXAttribute > JSXNamespacedName[namespace.name=/^(class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXElement[openingElement.name.name="style"]', message: STYLING_MESSAGE },
      ],
    },
  },
)
