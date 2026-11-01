<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import NewtLogo from './NewtLogo.vue'
</script>

<template>
  <DefaultTheme.Layout>
    <template #nav-bar-title-before><NewtLogo class="nav-logo" /></template>
  </DefaultTheme.Layout>
</template>
