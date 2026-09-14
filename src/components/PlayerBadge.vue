<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  player: {
    type: Object,
    default: null,
  },
  muted: Boolean,
  reverse: Boolean,
  truncate: Boolean,
  nameClass: {
    type: String,
    default: '',
  },
  size: {
    type: String,
    default: 'md', // sm | md | lg
  },
})

const imgFailed = ref(false)

watch(
  () => props.player?.avatar,
  () => {
    imgFailed.value = false
  },
)

const avatarClass = computed(() => {
  const map = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-14 w-14 text-base',
  }
  return map[props.size] || map.md
})
</script>

<template>
  <span class="inline-flex items-center gap-2" :class="[reverse ? 'flex-row-reverse' : '', truncate ? 'min-w-0' : '']">
    <img
      v-if="player?.avatar && !imgFailed"
      :src="player.avatar"
      alt=""
      class="shrink-0 rounded-full object-cover"
      :class="avatarClass"
      @error="imgFailed = true"
    />
    <span
      v-else
      class="flex shrink-0 items-center justify-center rounded-full bg-[#c9a24b] font-bold text-white dark:bg-[#b89335] dark:text-white"
      :class="avatarClass"
    >
      {{ (player?.name || '?').slice(0, 1) }}
    </span>
    <span :class="[muted ? 'text-[#a4a097]' : 'font-medium', truncate ? 'min-w-0 truncate' : '', nameClass]">
      {{ player?.name || '待定' }}
    </span>
  </span>
</template>
