---
name: newt-react-ui
description: Use before writing or changing any React UI of a newt application (pages, screens, forms, lists, dialogs, layout). The app's pages compose newt-react-ui's components and never style; anything new is a component in the app's own components folder.
---

# Writing UI with newt-react-ui

1. Read `node_modules/newt-react-ui/AGENTS.md`: the catalog, and the rule.
2. Build the page from those components only: no `className`, `style`, `<style>`, no
   `<div>`/`<span>` (only `form` and `fieldset`), no Radix, no `cn`.
3. Need something the catalog has not? First compose (`Stack`, `Box`, `Card`,
   `Field`). If it truly is new, make it in the app's components folder, from the
   library's components and the theme's tokens, with props in the app's words (never a
   `className` prop), and use it from the page.
4. Never copy a library component to change it, nor restyle one from a page.
5. Run the lint (`bunx eslint`): `newt-react-ui/lint` says where a page styles or writes
   HTML. Fix it by composing, never by silencing the rule.
