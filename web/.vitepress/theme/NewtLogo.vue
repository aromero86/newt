<script setup lang="ts">
/** newt's logotype: its four letters cut out of different papers, like a ransom note, all of them gruvbox's greens. */
withDefaults(defineProps<{ letters?: number[] }>(), { letters: () => [0, 1, 2, 3] })
const word = ['n', 'e', 'w', 't']
</script>

<template>
  <span class="newt-logo" role="img" aria-label="newt">
    <span v-for="index in letters" :key="index" :class="`cut cut-${index}`" aria-hidden="true">{{ word[index] }}</span>
  </span>
</template>

<style>
/* Not scoped: the landing flies each cut-out on its own, and each keeps its paper wherever it is drawn. */
.newt-logo { position: relative; display: inline-flex; align-items: center; gap: .07em; line-height: 1; letter-spacing: 0; }
.newt-logo .cut { display: inline-grid; place-items: center; height: 1.08em; padding: 0 .12em; box-shadow: 0 .03em 0 rgba(0, 0, 0, .18); transform: rotate(var(--turn)) translateY(var(--lift, 0)); }
.newt-logo .cut-0 { --turn: -5deg; font-family: 'Bowlby One', sans-serif; background: #427b58; color: #fbf1c7; }
.newt-logo .cut-1 { --turn: 4deg; --lift: -.07em; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 900; background: #fbf1c7; color: #427b58; outline: 1px solid #d5c4a1; }
.newt-logo .cut-2 { --turn: -1deg; --lift: .07em; font-family: 'Rubik Mono One', monospace; font-size: .85em; height: 1.27em; background: #8ec07c; color: #1d2021; }
.newt-logo .cut-3 { --turn: 6deg; font-family: 'Abril Fatface', serif; background: #79740e; color: #fbf1c7; }

/* In the nav, the cut-outs shuffle when the pointer is on them. */
.VPNavBarTitle:hover .newt-logo .cut { animation: newt-shuffle .45s cubic-bezier(.3, 1.6, .5, 1) both; }
.VPNavBarTitle:hover .newt-logo .cut-1 { animation-delay: .04s; }
.VPNavBarTitle:hover .newt-logo .cut-2 { animation-delay: .08s; }
.VPNavBarTitle:hover .newt-logo .cut-3 { animation-delay: .12s; }
@keyframes newt-shuffle {
  40% { transform: rotate(calc(var(--turn) * -2.2)) translateY(-.12em) scale(1.08); }
  100% { transform: rotate(var(--turn)) translateY(var(--lift, 0)); }
}
@media (prefers-reduced-motion: reduce) { .VPNavBarTitle:hover .newt-logo .cut { animation: none; } }
</style>
