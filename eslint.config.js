import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends the rules of a UI built from one library. The framework's own code is not
// an application, so it is left out; newt-monitor is one, so it is in.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})

// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/src/contexts', uses: { monitor: [] } },
})

// The frontends build their UI from @cooper/ui only. Styling lives in cooper/libs/ui and
// in each app's own components/ folder; everywhere else, class names and inline styles
// are forbidden, and so is reaching past @cooper/ui into shadcn or Radix.

const FRONTEND = ['cooper/frontend/**/*.{ts,tsx}', 'cooper/libs/**/*.{ts,tsx}']
// Where styling is allowed: the UI library, and each app's own UI pieces.
const STYLED = ['cooper/libs/ui/**', 'cooper/frontend/*/components/**']

const STYLING_MESSAGE = 'Apps do not style: use a component from @cooper/ui or from this app\'s own components/ folder.'

const UI_IMPORTS = [
  { group: ['radix-ui', '@radix-ui/*'], message: 'Use a component from @cooper/ui instead.' },
  { group: ['@cooper/ui/shadcn', '@cooper/ui/shadcn/*', '**/libs/ui/shadcn', '**/libs/ui/shadcn/**'], message: 'shadcn is private to @cooper/ui: use @cooper/ui/components/*.' },
]

// The frontend reaches the backend only through @cooper/api, the API clients.
const BACKEND_IMPORTS = {
  regex: '(^|/)backend(/|$)',
  message: 'The frontend never imports the backend: use the client in @cooper/api.',
}

// The API clients share the backend's contract, never its code: a module's schema file
// is the only thing they may import from the backend.
const API_BACKEND_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$)|$)',
  message: '@cooper/api may only import a backend module\'s *.schema.ts (its contract).',
}

export default [
  { ignores: ['packages/newt/**', 'packages/newt-eslint/**', 'packages/newt-graph/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  ...MONITOR,
  {
    files: FRONTEND,
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ['cooper/frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, API_BACKEND_IMPORTS] }],
    },
  },
  {
    files: FRONTEND,
    ignores: STYLED,
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'JSXAttribute[name.name=/^(className|class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXAttribute > JSXNamespacedName[namespace.name=/^(class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXElement[openingElement.name.name="style"]', message: STYLING_MESSAGE },
      ],
    },
  },
]
