import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'

// Apps build their UI from @newt/ui only. Styling lives in src/libs/ui and in
// each app's own ui/ folder; everywhere else, class names and inline styles are
// forbidden, and so is reaching past @newt/ui into shadcn or Radix.

const APPS = ['src/frontend/**/*.{ts,tsx}', 'src/landing/**/*.{ts,tsx,astro}']
const APP_UI = ['src/frontend/ui/**', 'src/landing/ui/**']

const STYLING_MESSAGE = 'Apps do not style: use a component from @newt/ui or from this app\'s ui/ folder.'

export default tseslint.config(
  { ignores: ['dist/**', '**/.astro/**', '**/node_modules/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
  },
  ...astro.configs['flat/base'],
  {
    files: APPS,
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['radix-ui', '@radix-ui/*'], message: 'Use a component from @newt/ui instead.' },
          { group: ['@newt/ui/shadcn', '@newt/ui/shadcn/*', '**/libs/ui/shadcn/**'], message: 'shadcn is private to @newt/ui: use @newt/ui/components/*.' },
        ],
      }],
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
