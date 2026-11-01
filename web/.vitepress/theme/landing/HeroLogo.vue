<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import NewtLogo from '../NewtLogo.vue'

/**
 * The landing opens on the logotype, its cut-outs slapped down one after another. Scrolling sends each cut-out
 * flying on its own, with a hop and a spin, into the nav, where the nav's own logotype takes over once they land.
 * The flight takes four times the scroll its distance would: the hero holds still (--newt-runway, three of them)
 * while the cut-outs fly, and only then scrolls away.
 */
const place = ref<HTMLElement>()
const cuts = ref<HTMLElement[]>([])
const mounted = ref(false)
let frame = 0

/** How far each cut-out spins on its way, and how late it leaves after the one before. */
const spins = [-32, 38, -46, 26]
const STAGGER = 0.1
/** How many times its distance the flight takes to scroll. */
const SLOWDOWN = 4
let runway = 0
const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

function draw() {
  frame = 0
  const logo = place.value?.querySelector<HTMLElement>('.newt-logo')
  const target = document.querySelector<HTMLElement>('.VPNavBarTitle .nav-logo')
  if (!logo || !target) return
  const scroll = window.scrollY
  const start = logo.getBoundingClientRect()
  const end = target.getBoundingClientRect()
  const k = end.width / start.width
  // Where the logotype stood before any scroll: the hero holds still for the runway, then scrolls.
  const top = start.top + Math.max(0, scroll - runway)
  const distance = Math.max(1, top - end.top)
  if (Math.abs(runway - distance * (SLOWDOWN - 1)) > 1) {
    runway = distance * (SLOWDOWN - 1)
    document.documentElement.style.setProperty('--newt-runway', `${runway}px`)
  }
  const t = clamp(scroll / (distance * SLOWDOWN))
  document.documentElement.classList.toggle('newt-landed', t >= 1)
  logo.querySelectorAll<HTMLElement>('.cut').forEach((cut, index) => {
    const flying = cuts.value[index]
    if (!flying) return
    const w = cut.offsetWidth, h = cut.offsetHeight
    const local = clamp((t - index * STAGGER) / (1 - 3 * STAGGER))
    const e = ease(local)
    const fromX = start.left + cut.offsetLeft + w / 2, toX = end.left + (cut.offsetLeft + w / 2) * k
    const fromY = top + cut.offsetTop + h / 2, toY = end.top + (cut.offsetTop + h / 2) * k
    const nowY = start.top + cut.offsetTop + h / 2
    const scale = lerp(1, k, e)
    // A hop the size of the cut-out as it is now, never out of the top of the window.
    const hop = Math.sin(Math.PI * local) * h * scale * (index % 2 ? 0.9 : 0.55)
    const x = lerp(fromX, toX, e)
    const y = Math.max(h * scale * 0.7, Math.min(Math.max(toY, nowY), lerp(fromY, toY, e)) - hop)
    const spin = Math.sin(Math.PI * local) * spins[index]!
    flying.style.width = `${w}px`
    flying.style.height = `${h}px`
    flying.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) rotate(${spin}deg) scale(${scale})`
  })
}
const schedule = () => { frame ||= requestAnimationFrame(draw) }

onMounted(() => {
  mounted.value = true
  document.documentElement.classList.add('newt-morph')
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  // The fonts change the cut-outs' sizes once they load.
  document.fonts?.ready.then(schedule)
  requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  document.documentElement.classList.remove('newt-morph', 'newt-landed')
  document.documentElement.style.removeProperty('--newt-runway')
  window.removeEventListener('scroll', schedule)
  window.removeEventListener('resize', schedule)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="place" class="place" :class="{ mounted }"><NewtLogo /></div>
  <Teleport v-if="mounted" to="body">
    <div class="flight" aria-hidden="true">
      <div v-for="index in 4" :key="index" ref="cuts" class="flying">
        <div class="pop" :style="{ '--i': index - 1 }"><NewtLogo :letters="[index - 1]" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.place, .flying { font-size: clamp(48px, 8vw, 96px); }
.place { display: block; width: max-content; margin-bottom: clamp(28px, 4vw, 44px); }
.place.mounted { visibility: hidden; }
.flying { position: fixed; top: 0; left: 0; z-index: calc(var(--vp-z-index-nav) + 1); display: grid; place-items: center; pointer-events: none; will-change: transform; }

/* Each cut-out is slapped down in turn: it falls big and turned, overshoots, and settles. */
.pop { animation: slap .6s cubic-bezier(.2, 1.5, .4, 1) both; animation-delay: calc(.15s + var(--i) * .13s); }
@keyframes slap {
  0% { opacity: 0; transform: translateY(-.6em) rotate(calc(-25deg + var(--i) * 17deg)) scale(2.2); }
  55% { opacity: 1; }
  100% { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .pop { animation: none; } }
</style>
<style>
.newt-morph:not(.newt-landed) .VPNavBarTitle .nav-logo { opacity: 0; }
.newt-landed .flight { visibility: hidden; }
</style>
