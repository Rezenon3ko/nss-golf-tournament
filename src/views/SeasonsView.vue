<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTournamentStore } from '@/stores/tournament'
import { useFeedbackStore } from '@/stores/feedback'
import BaseButton from '@/components/BaseButton.vue'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiArchiveOutline, mdiCalendar, mdiCheckCircle, mdiTrophyOutline } from '@mdi/js'

const store = useTournamentStore()
const feedback = useFeedbackStore()
const router = useRouter()

const loading = ref(true)
const players = ref([])
const busyId = ref('')

const enabled = computed(() => store.mirror.model === 'multi')
const seasons = computed(() => store.seasons || [])
const nameByPlayerId = computed(
  () => new Map(players.value.map((player) => [player.id, player.name])),
)

function championName(season) {
  if (!season.champion_player_id) return '冠军待定'
  return nameByPlayerId.value.get(season.champion_player_id) || '冠军待定'
}

function createdText(season) {
  if (!season.created_at) return ''
  const date = new Date(season.created_at)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

async function enter(season) {
  if (busyId.value) return
  if (season.id === store.currentSeasonId) {
    router.push('/')
    return
  }
  busyId.value = season.id
  try {
    const result = await store.switchSeason(season.id)
    if (!result.ok) {
      feedback.warn(result.message)
      return
    }
    feedback.success(`已切换到「${season.name}」`)
    router.push('/')
  } finally {
    busyId.value = ''
  }
}

onMounted(async () => {
  if (!enabled.value) {
    loading.value = false
    return
  }
  await store.loadSeasons()
  players.value = await store.loadSeasonPlayers(seasons.value.map((season) => season.id))
  loading.value = false
})
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8">
    <div class="mb-6">
      <h1 class="flex items-center gap-2 text-2xl font-bold">
        <BaseIcon :path="mdiCalendar" size="24" class="text-[#8c6d1f] dark:text-[#d8c48a]" />
        历届赛事
      </h1>
      <p class="mt-1 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        选择要查看的赛季，切换后全站（积分榜、淘汰赛、选手、数据统计）都会切到该届。
      </p>
    </div>

    <div v-if="!enabled" class="notion-card p-5 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
      当前为单文档模式，多赛季功能需要部署多表结构并开启
      <code class="font-mono">VITE_DATA_MODEL=multi</code>。
    </div>

    <div v-else-if="loading" class="notion-card p-5 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
      正在读取赛季列表…
    </div>

    <div
      v-else-if="!seasons.length"
      class="notion-card p-5 text-sm text-[#5d5b54] dark:text-[#a0a0a0]"
    >
      还没有任何赛季。
    </div>

    <div v-else class="flex flex-col gap-3">
      <div
        v-for="season in seasons"
        :key="season.id"
        class="notion-card flex flex-wrap items-center justify-between gap-3 p-5"
      >
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 font-bold">
            {{ season.name }}
            <span
              v-if="season.is_current"
              class="inline-flex items-center gap-1 rounded-full bg-[#c9a24b]/25 px-2 py-0.5 text-xs font-medium text-[#8c6d1f] dark:text-[#e4d3a4]"
            >
              <BaseIcon :path="mdiCheckCircle" size="14" w="w-4" h="h-4" />
              当前赛季
            </span>
            <span
              v-else-if="season.is_archived"
              class="inline-flex items-center gap-1 rounded-full bg-[#f0eeec] px-2 py-0.5 text-xs text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]"
            >
              <BaseIcon :path="mdiArchiveOutline" size="14" w="w-4" h="h-4" />
              已归档
            </span>
          </p>
          <p
            class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#5d5b54] dark:text-[#a0a0a0]"
          >
            <span class="inline-flex items-center gap-1">
              <BaseIcon :path="mdiTrophyOutline" size="14" />
              {{ championName(season) }}
            </span>
            <span v-if="createdText(season)" class="font-mono text-xs">{{
              createdText(season)
            }}</span>
          </p>
        </div>
        <BaseButton
          :label="season.id === store.currentSeasonId ? '进入' : '切换到本届'"
          :color="season.id === store.currentSeasonId ? 'whiteDark' : 'gold'"
          small
          :disabled="busyId === season.id"
          @click="enter(season)"
        />
      </div>
    </div>
  </div>
</template>
