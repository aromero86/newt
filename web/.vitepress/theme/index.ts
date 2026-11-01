import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Layout from './Layout.vue'
import Mermaid from './Mermaid.vue'
import Landing from './landing/Landing.vue'
// The logotype's four papers.
import '@fontsource/abril-fatface/latin-400.css'
import '@fontsource/bowlby-one/latin-400.css'
import '@fontsource/playfair-display/latin-900-italic.css'
import '@fontsource/rubik-mono-one/latin-400.css'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid)
    app.component('Landing', Landing)
  },
} satisfies Theme
