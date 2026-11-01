<script setup lang="ts">
import { withBase } from 'vitepress'

/** A screenshot in the page's theme: the light one in light mode, the dark one in dark. */
defineProps<{ name: string, alt: string }>()
</script>

<template>
  <figure class="shot">
    <img class="shot-light" :src="withBase(`/screenshots/${name}-light.png`)" :alt="alt" loading="lazy">
    <img class="shot-dark" :src="withBase(`/screenshots/${name}-dark.png`)" :alt="alt" loading="lazy">
  </figure>
</template>

<style scoped>
.shot { margin: 0; border-radius: 14px; overflow: hidden; border: 1px solid var(--vp-c-divider); box-shadow: 0 30px 60px -30px rgba(0, 0, 0, .35); background: var(--vp-c-bg); }
.shot img { display: block; width: 100%; height: auto; }
</style>
