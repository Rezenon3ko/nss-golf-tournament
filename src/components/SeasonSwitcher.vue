<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useFeedbackStore } from '@/stores/feedback'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiCalendar, mdiCheck, mdiChevronDown } from '@mdi/js'

const store = useTournamentStore()
const feedback = useFeedbackStore()
const busy = ref(false)
const open = ref(false)
const root = ref(null)

const enabled = computed(() => store.mirror.model === 'multi')
const seasons = computed(() => store.seasons || [])
const currentId = computed(() => store.currentSeasonId || '')

const currentLabel = computed(() => {
  const season = seasons.value.find((item) => item.id === currentId.value)
  if (!season) return ''
  return season.name
})

onMounted(() => {
  if (enabled.value) void store.loadSeasons()
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

function onDocumentPointerDown(event) {
  if (root.value && !root.value.contains(event.target)) close()
}

function onKeydown(event) {
  if (event.key === 'Escape') close()
}

function toggle() {
  if (!busy.value) open.value = !open.value
}

function close() {
  open.value = false
}

async function pick(season) {
  if (busy.value) return
  if (season.id === currentId.value) {
    close()
    return
  }
  busy.value = true
  try {
    const result = await store.switchSeason(season.id)
    if (!result.ok) {
      feedback.warn(result.message)
      return
    }
    feedback.success(`已切换到「${season.name}」`)
    close()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!--
    自绘下拉：按钮宽度完全由当前赛季名决定（原生 select 会为箭头预留固定空间，
    既留白又和文字对不齐）。日历图标 / 文字 / 箭头三个同级元素间距一致，
    高度 h-9 与其他顶栏按钮一致，箭头不会压到文字。
  -->
  <div v-if="enabled && seasons.length" ref="root" class="relative">
    <button
      type="button"
      :disabled="busy"
      :title="`切换赛季：${currentLabel}`"
      class="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-[#e5e3df] bg-[#f6f5f4] px-2 text-sm text-[#37352f] hover:bg-[#f0eeec] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#3d3d3d] dark:bg-[#2a2a2a] dark:text-[#e6e6e6] dark:hover:bg-[#333333]"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggle"
    >
      <BaseIcon :path="mdiCalendar" size="18" class="shrink-0 text-[#8c6d1f] dark:text-[#d8c48a]" />
      <span class="max-w-[12rem] truncate">{{ currentLabel }}</span>
      <BaseIcon
        :path="mdiChevronDown"
        size="16"
        class="shrink-0 text-[#787671] dark:text-[#a0a0a0]"
      />
    </button>

    <ul
      v-if="open"
      role="listbox"
      class="absolute right-0 z-50 mt-1 max-h-72 w-max min-w-full overflow-y-auto rounded-md border border-[#e5e3df] bg-white py-1 shadow-[rgba(15,15,15,0.16)_0px_16px_48px_-8px] dark:border-[#3d3d3d] dark:bg-[#1e1e1e]"
    >
      <li v-for="season in seasons" :key="season.id">
        <button
          type="button"
          role="option"
          :aria-selected="season.id === currentId"
          class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#f0eeec] dark:hover:bg-[#333333]"
          :class="
            season.id === currentId
              ? 'font-semibold text-[#8c6d1f] dark:text-[#e4d3a4]'
              : 'text-[#37352f] dark:text-[#e6e6e6]'
          "
          @click="pick(season)"
        >
          <BaseIcon v-if="season.id === currentId" :path="mdiCheck" size="14" class="shrink-0" />
          <span class="truncate">{{ season.name }}</span>
          <span v-if="season.is_archived" class="ml-auto pl-2 text-xs text-[#a4a097]">已归档</span>
          <span
            v-else-if="season.is_current"
            class="ml-auto pl-2 text-xs text-[#8c6d1f] dark:text-[#e4d3a4]"
            >当前</span
          >
        </button>
      </li>
    </ul>
  </div>
</template>
