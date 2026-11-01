<script setup lang="ts">
import { withBase } from 'vitepress'

/** A screenshot of newt-monitor or cooper, light or dark as the page is, made light for the landing (webp). */
defineProps<{ name: string, alt: string, eager?: boolean }>()
</script>

<template>
  <div class="shot">
    <img class="shot-light" :src="withBase(`/landing/${name}-light.webp`)" :alt="alt" :loading="eager ? 'eager' : 'lazy'" decoding="async">
    <img class="shot-dark" :src="withBase(`/landing/${name}-dark.webp`)" :alt="alt" :loading="eager ? 'eager' : 'lazy'" decoding="async">
  </div>
</template>

<style scoped>
.shot img { width: 100%; height: auto; }
</style>
