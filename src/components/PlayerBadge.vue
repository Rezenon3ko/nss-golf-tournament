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
  <!--
    用 block 级 flex（而不是 inline-flex）：头像 <img> 在 preflight 里是 display:block，
    内联盒会以图片底边为基线，导致带头像的行比不带头像的行高 6px、内容整体上移 3px；
    改成块级盒子后由父级（如 td 的 vertical-align: middle）负责垂直居中，行高也统一。
  -->
  <span class="flex items-center gap-2" :class="[reverse ? 'flex-row-reverse' : '', truncate ? 'min-w-0' : '']">
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
      class="flex shrink-0 items-center justify-center rounded-full bg-[#c9a24b]/25 font-bold text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4]"
      :class="avatarClass"
    >
      {{ (player?.name || '?').slice(0, 1) }}
    </span>
    <span :class="[muted ? 'text-[#a4a097]' : 'font-medium', truncate ? 'min-w-0 truncate' : '', nameClass]">
      {{ player?.name || '待定' }}
    </span>
  </span>
</template>
