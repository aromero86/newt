<script setup lang="ts">
import { ref } from 'vue'
import { onInView, reducedMotion } from './motion'

/** A number that counts up to its value the first time it is seen. */
const props = defineProps<{ to: number, decimals?: number, suffix?: string }>()
const root = ref<HTMLElement>()
const shown = ref(0)
const format = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: props.decimals ?? 0, maximumFractionDigits: props.decimals ?? 0 })

onInView(root, () => {
  if (reducedMotion()) { shown.value = props.to; return }
  const start = performance.now()
  const duration = 1600
  const step = (time: number) => {
    const progress = Math.min(1, (time - start) / duration)
    shown.value = props.to * (1 - Math.pow(1 - progress, 4))
    if (progress < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}, { once: true, threshold: 0.6 })
</script>

<template>
  <span ref="root" class="counter">{{ format(shown) }}{{ suffix }}</span>
</template>

<style scoped>
.counter { font-variant-numeric: tabular-nums; }
</style>
