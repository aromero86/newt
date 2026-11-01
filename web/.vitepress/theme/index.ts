import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import Mermaid from './Mermaid.vue'
import Landing from './landing/Landing.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Mermaid', Mermaid)
    app.component('Landing', Landing)
  },
} satisfies Theme
