<script setup>
import { computed, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import GroupTabs from '@/components/GroupTabs.vue'
import PlayerBadge from '@/components/PlayerBadge.vue'
import MatchStatusPill from '@/components/MatchStatusPill.vue'
import BaseButton from '@/components/BaseButton.vue'
import MatchDetailModal from '@/components/MatchDetailModal.vue'
import ScoreEntryModal from '@/components/ScoreEntryModal.vue'
import { formatDateTime } from '@/utils/format'

const store = useTournamentStore()
const auth = useAuthStore()

const activeGroup = ref('A')
const statusFilter = ref('all')
const detailMatch = ref(null)
const entryMatch = ref(null)

const statusFilters = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '未开始' },
  { value: 'complete', label: '已完赛' },
  { value: 'forfeit', label: '判负' },
  { value: 'overdue', label: '逾期' },
]

const groupMatches = computed(() => store.groupMatches[activeGroup.value])

// 行悬停：当前组色的浅色版（交替行已去掉）
const activeTintHover = computed(() => {
  const map = {
    A: 'transition-colors hover:bg-[#f3effb] dark:hover:bg-[#8478b4]',
    B: 'transition-colors hover:bg-[#ecf9f0] dark:hover:bg-[#7a8e81]',
    C: 'transition-colors hover:bg-[#eef6fd] dark:hover:bg-[#79879f]',
    D: 'transition-colors hover:bg-[#fff4ea] dark:hover:bg-[#9d8575]',
  }
  return map[activeGroup.value] || map.A
})

const filteredMatches = computed(() => {
  const rows = groupMatches.value.map((match) => {
    const ddl = store.ddlForMatch(match)
    const overdue = match.status === 'pending' && ddl && new Date(ddl).getTime() < Date.now()
    return { match, ddl, overdue }
  })
  if (statusFilter.value === 'all') return rows
  if (statusFilter.value === 'overdue') return rows.filter((r) => r.overdue)
  return rows.filter((r) => r.match.status === statusFilter.value)
})

function displayStatus(row) {
  return row.overdue ? 'overdue' : row.match.status
}

function openDetail(match) {
  detailMatch.value = match
}

function openEntry(match) {
  entryMatch.value = match
}

function onEntrySaved() {
  entryMatch.value = null
}

</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">小组赛</h1>
        <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
          每组 6 场 · 三局两胜（BO3）· 胜 2 分 / 负 1 分
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="f in statusFilters"
          :key="f.value"
          type="button"
          class="rounded-full px-3 py-1 text-sm"
          :class="
            statusFilter === f.value
              ? 'notion-pill-active font-semibold'
              : 'bg-[#f6f5f4] text-[#5d5b54] hover:bg-[#e8e6e2] dark:bg-[#1e1e1e] dark:text-[#c7c7c7]'
          "
          @click="statusFilter = f.value"
        >
          {{ f.label }}
        </button>
      </div>
    </div>

    <div class="mb-5">
      <GroupTabs v-model="activeGroup" />
    </div>

    <div class="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
      <span
        v-for="round in [1, 2, 3]"
        :key="round"
        class="inline-flex items-baseline gap-1"
      >
        <span class="w-[85px] shrink-0">第{{ round }}轮 DDL：</span>
        <span>
          {{ formatDateTime(store.ddlRounds.find((d) => d.stage === 'group' && d.round === round)?.ddl) }}
        </span>
      </span>
    </div>

    <div class="notion-card">
      <div class="hidden overflow-x-auto lg:block">
      <table class="notion-table w-full table-fixed text-base">
        <thead>
          <tr class="border-b border-[#e5e3df] text-left text-sm text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]">
            <th class="w-20 px-4 py-3">轮次</th>
            <th class="w-[320px] px-4 py-3">对阵</th>
            <th class="w-20 px-4 py-3">比分</th>
            <th class="w-16 px-4 py-3">SD</th>
            <th class="w-48 px-4 py-3">DDL</th>
            <th class="w-28 px-4 py-3">状态</th>
            <th class="w-36 px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in filteredMatches"
            :key="row.match.id"
            class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
            :class="[
              row.overdue ? 'rounded-lg bg-[#fdecec] dark:bg-[#2a1a1a]' : '',
              activeTintHover,
            ]"
          >
            <td class="px-4 py-3 font-semibold text-[#5d5b54] dark:text-[#a0a0a0]">
              第 {{ row.match.round }} 轮
            </td>
            <td class="px-4 py-3">
              <div class="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
                <PlayerBadge :player="store.playerById(row.match.playerAId)" />
                <span class="text-center text-[#a4a097]">vs</span>
                <PlayerBadge
                  :player="store.playerById(row.match.playerBId)"
                  reverse
                  class="justify-self-end"
                />
              </div>
            </td>
            <td class="px-4 py-3 font-bold">
              {{
                row.match.status === 'complete'
                  ? `${store.matchScore(row.match).a} : ${store.matchScore(row.match).b}`
                  : row.match.status === 'forfeit'
                    ? '判负'
                    : '-'
              }}
            </td>
            <td class="px-4 py-3 text-[#a4a097]">
              {{
                row.match.sets.some(
                  (s) => s.a != null && s.b != null && s.a === s.b,
                )
                  ? '是'
                  : '-'
              }}
            </td>
            <td class="px-4 py-3 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
              {{ formatDateTime(row.ddl) }}
            </td>
            <td class="px-4 py-3">
              <MatchStatusPill :status="displayStatus({ match: row.match, overdue: row.overdue })" />
            </td>
            <td class="px-4 py-3 text-right">
              <div class="flex flex-wrap items-center justify-end gap-1">
                <BaseButton label="查看" color="whiteDark" small @click="openDetail(row.match)" />
                <BaseButton
                  v-if="auth.isAdmin"
                  label="录入"
                  color="gold"
                  small
                  @click="openEntry(row.match)"
                />
              </div>
            </td>
          </tr>
          <tr v-if="!filteredMatches.length">
            <td colspan="7" class="px-4 py-8 text-center text-[#a4a097]">暂无比赛</td>
          </tr>
        </tbody>
      </table>
      </div>
      <div class="divide-y divide-[#ede9e4] lg:hidden dark:divide-[#2e2e2e]">
        <div
          v-for="(row, index) in filteredMatches"
          :key="row.match.id"
          class="p-4"
          :class="[
              row.overdue ? 'rounded-lg bg-[#fdecec] dark:bg-[#2a1a1a]' : '',
              activeTintHover,
            ]"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-sm font-semibold text-[#5d5b54] dark:text-[#a0a0a0]">
              第 {{ row.match.round }} 轮
            </span>
            <MatchStatusPill :status="displayStatus({ match: row.match, overdue: row.overdue })" />
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <PlayerBadge :player="store.playerById(row.match.playerAId)" size="md" />
            <span class="text-center text-[#a4a097]">vs</span>
            <PlayerBadge
              :player="store.playerById(row.match.playerBId)"
              size="md"
              reverse
              class="justify-self-end"
            />
          </div>
          <div class="mt-3 text-center">
            <span class="text-3xl font-black text-[#1a1a1a] dark:text-[#e6e6e6]">{{
              row.match.status === 'complete'
                ? `${store.matchScore(row.match).a} : ${store.matchScore(row.match).b}`
                : row.match.status === 'forfeit'
                  ? '判负'
                  : '-'
            }}</span>

          </div>
          <div
            class="mt-2 flex items-center justify-between gap-2 text-sm text-[#5d5b54] dark:text-[#a0a0a0]"
          >
            <span>{{ formatDateTime(row.ddl) }}</span>
            <div class="flex gap-1">
              <BaseButton label="查看" color="whiteDark" small @click="openDetail(row.match)" />
              <BaseButton
                v-if="auth.isAdmin"
                label="录入"
                color="gold"
                small
                @click="openEntry(row.match)"
              />
            </div>
          </div>
        </div>
        <div v-if="!filteredMatches.length" class="p-6 text-center text-sm text-[#a4a097]">
          暂无比赛
        </div>
      </div>
    </div>

    <MatchDetailModal
      v-if="detailMatch"
      :match="detailMatch"
      @close="detailMatch = null"
    />
    <ScoreEntryModal
      v-if="entryMatch"
      :match="entryMatch"
      @close="entryMatch = null"
      @saved="onEntrySaved"
    />
  </div>
</template>
