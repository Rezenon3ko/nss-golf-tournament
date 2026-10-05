<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useFeedbackStore } from '@/stores/feedback'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiCalendar, mdiChevronDown } from '@mdi/js'

const store = useTournamentStore()
const feedback = useFeedbackStore()
const busy = ref(false)

const enabled = computed(() => store.mirror.model === 'multi')
const seasons = computed(() => store.seasons || [])
const currentId = computed(() => store.currentSeasonId || '')

onMounted(() => {
  if (enabled.value) void store.loadSeasons()
})

function optionLabel(season) {
  if (season.is_archived) return `${season.name}（已归档）`
  if (season.is_current) return `${season.name}（当前）`
  return season.name
}

const currentLabel = computed(() => {
  const season = seasons.value.find((item) => item.id === currentId.value)
  return season ? optionLabel(season) : ''
})

async function onChange(event) {
  const seasonId = event.target.value
  if (busy.value || !seasonId || seasonId === currentId.value) return
  busy.value = true
  try {
    const result = await store.switchSeason(seasonId)
    if (!result.ok) {
      feedback.warn(result.message)
      event.target.value = currentId.value
      return
    }
    feedback.success('已切换赛季')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="enabled && seasons.length" class="flex items-center gap-1">
    <BaseIcon :path="mdiCalendar" size="18" class="shrink-0 text-[#8c6d1f] dark:text-[#d8c48a]" />
    <div class="relative">
      <select
        :value="currentId"
        :disabled="busy"
        :title="`切换赛季：${currentLabel}`"
        class="max-w-[16rem] truncate rounded-md border border-[#e5e3df] bg-[#f6f5f4] py-1.5 pr-8 pl-2 text-sm text-[#37352f] focus:outline-hidden disabled:opacity-60 dark:border-[#3d3d3d] dark:bg-[#2a2a2a] dark:text-[#e6e6e6]"
        @change="onChange"
      >
        <option v-for="season in seasons" :key="season.id" :value="season.id">
          {{ optionLabel(season) }}
        </option>
      </select>
      <BaseIcon
        :path="mdiChevronDown"
        size="16"
        class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[#787671] dark:text-[#a0a0a0]"
      />
    </div>
  </div>
</template>
