<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useTournamentStore } from '@/stores/tournament'
import PlayerBadge from '@/components/PlayerBadge.vue'
import MatchStatusPill from '@/components/MatchStatusPill.vue'
import MatchDetailModal from '@/components/MatchDetailModal.vue'
import BaseButton from '@/components/BaseButton.vue'

const route = useRoute()
const store = useTournamentStore()

const player = computed(() => store.players.find((p) => p.id === route.params.id) || null)
const groupRow = computed(() => {
  if (!player.value?.groupId) return null
  return (
    store.getStandings(player.value.groupId).find((r) => r.playerId === player.value.id) || null
  )
})

const tab = ref('all')
const tabs = [
  { value: 'all', label: '全部' },
  { value: 'group', label: '小组赛' },
  { value: 'ko', label: '淘汰赛' },
]

const matches = computed(() => {
  if (!player.value) return []
  const list = store.matches.filter(
    (m) => m.playerAId === player.value.id || m.playerBId === player.value.id,
  )
  if (tab.value === 'group') return list.filter((m) => m.stage === 'group')
  if (tab.value === 'ko') return list.filter((m) => m.stage !== 'group')
  return list
})

const detailMatch = ref(null)

function stageLabel(match) {
  if (match.stage === 'group') return `${match.groupId}组 第${match.round}轮`
  return store.STAGE_LABELS[match.stage] || ''
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <RouterLink to="/players" class="mb-4 inline-block text-sm text-[#0075de]">
      ← 返回选手列表
    </RouterLink>

    <template v-if="player">
      <div class="mb-5 notion-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <PlayerBadge :player="player" size="lg" />
            <div class="mt-2 flex flex-wrap gap-2 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
              <span>{{ player.tier }}档</span>
              <span v-if="player.groupId">{{ player.groupId }}组</span>
              <span v-if="player.bestScore">历史最佳：{{ player.bestScore }} 杆</span>
            </div>
          </div>
          <div v-if="groupRow" class="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
            <div class="rounded-xl notion-card-soft px-4 py-2">
              <p class="text-xs text-[#a4a097]">排名</p>
              <p class="text-xl font-bold">第 {{ groupRow.rank }} 名</p>
            </div>
            <div class="rounded-xl notion-card-soft px-4 py-2">
              <p class="text-xs text-[#a4a097]">积分</p>
              <p class="text-xl font-bold">{{ groupRow.points }}</p>
            </div>
            <div class="rounded-xl notion-card-soft px-4 py-2">
              <p class="text-xs text-[#a4a097]">净胜局</p>
              <p class="text-xl font-bold">{{ groupRow.setDiff }}</p>
            </div>
            <div class="rounded-xl notion-card-soft px-4 py-2">
              <p class="text-xs text-[#a4a097]">净胜杆</p>
              <p class="text-xl font-bold">{{ groupRow.strokeDiff }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-4 flex flex-wrap gap-2">
        <button
          v-for="t in tabs"
          :key="t.value"
          type="button"
          class="rounded-full px-4 py-1.5 text-sm"
          :class="
            tab === t.value
              ? 'notion-pill-active font-semibold'
              : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#1e1e1e] dark:text-[#c7c7c7]'
          "
          @click="tab = t.value"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="overflow-x-auto notion-card">
        <table class="notion-table w-full text-sm">
          <thead>
            <tr class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]">
              <th class="px-4 py-3">阶段</th>
              <th class="px-4 py-3">对阵</th>
              <th class="px-4 py-3">比分</th>
              <th class="px-4 py-3">结果</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="match in matches"
              :key="match.id"
              class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
            >
              <td class="px-4 py-3 text-[#5d5b54] dark:text-[#a0a0a0]">{{ stageLabel(match) }}</td>
              <td class="px-4 py-3">
                {{ store.playerName(match.playerAId) }} vs {{ store.playerName(match.playerBId) }}
              </td>
              <td class="px-4 py-3 font-bold">
                {{
                  match.status === 'complete'
                    ? `${store.matchScore(match).a} : ${store.matchScore(match).b}`
                    : '-'
                }}
              </td>
              <td class="px-4 py-3">
                <MatchStatusPill :status="match.status" />
              </td>
              <td class="px-4 py-3 text-right">
                <BaseButton label="查看" color="whiteDark" small @click="detailMatch = match" />
              </td>
            </tr>
            <tr v-if="!matches.length">
              <td colspan="5" class="px-4 py-8 text-center text-[#a4a097]">暂无对局</td>
            </tr>
          </tbody>
        </table>
      </div>

      <MatchDetailModal v-if="detailMatch" :match="detailMatch" @close="detailMatch = null" />
    </template>

    <p v-else class="py-12 text-center text-[#a4a097]">选手不存在</p>
  </div>
</template>
