# newt-react-ui, for coding agents

The components of a React frontend of a newt application. Read this before writing
any UI: what there is, and the one rule that keeps every app the same.

## The rule

**A page composes components. It never styles.** Outside the app's own components
folder there is no `className`, `class`, `style` nor `<style>`, no HTML element but
`form` and `fieldset`, no Radix, no `cn` nor `class-variance-authority`. The lint
(`newt-react-ui/lint`) refuses them.

When nothing here fits:

1. Look again: most needs are a composition (`Stack` of `Card`s, a `Box` of rows, a
   `Field` around an `Input`).
2. Make a component in the app's components folder: it wraps or composes these, and
   there, only there, it may style (Tailwind, with the theme's tokens: `bg-card`,
   `text-muted-foreground`, `border-border`). Give it props in the app's words, never
   a `className`.
3. Never restyle a component of the library from a page, nor copy one to change it.

## Setting an app up

```css
/* the app's stylesheet */
@import "newt-react-ui/theme.css";
@source "./";
```

```tsx
<LinkProvider component={RouterLink}>   {/* every library link goes through the app's router */}
  <AppShell brand={…} actions={…}>…</AppShell>
  <Toaster />
</LinkProvider>
```

```js
// eslint.config.js
import { newtReactUi } from 'newt-react-ui/lint'
export default [...newtReactUi({ files: ['web/**/*.{ts,tsx}'], components: ['web/components/**'] })]
```

Light is the default theme; `dark` on `<html>` switches it. Import each component by
its folder: `import { Button } from 'newt-react-ui/button'`.

## The components

### Layout
| Component | For |
|---|---|
| `Stack` | Children one under another, with a `gap` from the spacing scale. |
| `Inline` | Children side by side: `gap`, `align`, `justify`, `wrap`. |
| `Grid` | Columns per breakpoint: `columns={{ base: 1, md: 3 }}`. |
| `Container` | Centers content and caps its width. |
| `Box`, `BoxHeader`, `BoxRow`, `BoxRowTitle`, `BoxRowMeta`, `BoxBody`, `BoxFooter`, `BoxEmpty`, `BoxFilter` | A bordered list of rows, with a header, filters, an empty state and a footer. |
| `Card` | A titled panel, with an action and a footer. |

### Pages
| Component | For |
|---|---|
| `AppShell` | Every page's frame: the bar with the brand, where you are and the actions. |
| `PageBody` | A page's width: `narrow`, `medium`, `wide`. |
| `PageHeader` | A page's title, description and actions. |
| `PageTitle` | The title of a page about one thing, with its reference. |
| `PageBand` | The band at the top of a page about one thing: its name, facts and tabs. |
| `NarrowPage` | One narrow column, for focused pages: signing in. |
| `SidebarLayout`, `SidebarSection` | Content with an aside: settings menus, details. |
| `SideNav`, `SideNavHeading`, `SideNavItem`, `NavItem` | The menu at the side, one link per section. |
| `UnderlineNav`, `UnderlineNavItem` | Tabs that are links: the parts of the same thing. |
| `Breadcrumbs` | Where you are, down to this page. |
| `Subhead` | A section's heading within a page; `danger` for what can break things. |

### Text
| Component | For |
|---|---|
| `Heading` | A heading, by `level`. |
| `Text` | Text: `size`, `tone`, `weight`. |
| `Emphasis`, `Strong`, `Mono`, `Tone` | Marks inside text. |
| `TextLink` | A link inside text. |
| `RelativeTime` | "2 days ago", the exact time on hover. |

### Actions and states
| Component | For |
|---|---|
| `Button` | Every action; with `href` it is a link; `loading` disables it while it works; `size="icon"` needs a `label`. |
| `Menu` | Actions behind a `Button`. |
| `Badge` | A short state: `tone` `ok`, `warn`, `bad`, `info`, `muted`, `brand`. |
| `Alert` | A message about the page: `info`, `ok`, `warn`, `bad`. |
| `EmptyState` | What a list or a page with nothing shows, and what to do. |
| `Spinner`, `Skeleton` | Loading: a spinner, or the shape of what is coming. |
| `Avatar` | A person's initial. |
| `Icon` | An icon (lucide-react), sized by the library. |
| `Toaster`, `toast` | A passing message after an action; `Toaster` once, near the root. |

### Forms
| Component | For |
|---|---|
| `Field` | A control with its label, help and error, tied together for screen readers. |
| `Label` | A label on its own, when there is no `Field`. |
| `Input`, `Textarea` | Text. |
| `Select` | One of a few options. |
| `Checkbox` | Yes or no. |
| `SearchField` | A search, with its accessible name. |

### Layers
| Component | For |
|---|---|
| `Dialog` | A question or a small form over the page. |
| `ConfirmDialog` | "Are you sure?": what happens, and one button; `destructive` for what cannot be undone. |

### Data
| Component | For |
|---|---|
| `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | Rows and columns, with a `caption`. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | Views of the same thing, on one page. |
| `Stat` | A number and what it counts. |
| `BarChart` | A few values as bars. |

### Links
| Component | For |
|---|---|
| `LinkProvider` | Every link of the library through the app's router; once, around the app. |
| `RouterLinkProvider` (`newt-react-ui/router-link`) | The same, for React Router. |
