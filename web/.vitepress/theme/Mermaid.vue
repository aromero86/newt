<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'

/** A Mermaid diagram, drawn in the browser in the page's theme, and again when it changes. */
const props = defineProps<{ code: string }>()
const { isDark } = useData()
const svg = ref('')
let drawn = 0

async function draw() {
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'var(--vp-font-family-base)',
    themeVariables: isDark.value
      ? { primaryColor: '#32302f', primaryTextColor: '#ebdbb2', primaryBorderColor: '#8ec07c', lineColor: '#a89984', secondaryColor: '#3c3836', tertiaryColor: '#282828', background: '#1d2021', mainBkg: '#32302f', clusterBkg: '#282828', clusterBorder: '#504945', noteBkgColor: '#3c3836', noteTextColor: '#fabd2f', noteBorderColor: '#d79921', edgeLabelBackground: '#1d2021', actorBkg: '#32302f', actorBorder: '#8ec07c', signalColor: '#d5c4a1', signalTextColor: '#ebdbb2', labelBoxBkgColor: '#32302f', labelTextColor: '#ebdbb2' }
      : { primaryColor: '#ffffff', primaryTextColor: '#282828', primaryBorderColor: '#427b58', lineColor: '#7c6f64', secondaryColor: '#f3f1ec', tertiaryColor: '#fcfbf8', background: '#fcfbf8', mainBkg: '#ffffff', clusterBkg: '#f8f7f3', clusterBorder: '#ddd8cc', noteBkgColor: '#fbf3db', noteTextColor: '#b57614', noteBorderColor: '#d79921', edgeLabelBackground: '#fcfbf8', actorBkg: '#ffffff', actorBorder: '#427b58', signalColor: '#504945', signalTextColor: '#282828', labelBoxBkgColor: '#ffffff', labelTextColor: '#282828' },
  })
  const id = `mermaid-${Math.random().toString(36).slice(2)}-${drawn++}`
  svg.value = (await mermaid.render(id, decodeURIComponent(props.code))).svg
}

onMounted(draw)
watch(isDark, draw)
</script>

<template>
  <div class="mermaid-diagram" v-html="svg" />
</template>
