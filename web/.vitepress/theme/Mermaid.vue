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
      ? { primaryColor: '#123d33', primaryTextColor: '#e6f4ef', primaryBorderColor: '#34d399', lineColor: '#8aa39b', secondaryColor: '#3d2a12', tertiaryColor: '#1b1f24', background: '#1b1b1f', mainBkg: '#123d33', clusterBkg: '#161b1f', clusterBorder: '#2f4a42', noteBkgColor: '#3d2a12', noteTextColor: '#fde7c8', edgeLabelBackground: '#1b1b1f' }
      : { primaryColor: '#e3f6ef', primaryTextColor: '#0b3b2e', primaryBorderColor: '#0f9d76', lineColor: '#5b7a71', secondaryColor: '#fff1e0', tertiaryColor: '#f6f8f7', background: '#ffffff', mainBkg: '#e3f6ef', clusterBkg: '#f6faf8', clusterBorder: '#b9dccf', noteBkgColor: '#fff1e0', noteTextColor: '#5a3410', edgeLabelBackground: '#ffffff' },
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
