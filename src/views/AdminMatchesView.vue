<script setup>
import { computed, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import PlayerBadge from '@/components/PlayerBadge.vue'
import MatchStatusPill from '@/components/MatchStatusPill.vue'
import BaseButton from '@/components/BaseButton.vue'
import MatchDetailModal from '@/components/MatchDetailModal.vue'
import ScoreEntryModal from '@/components/ScoreEntryModal.vue'
import { formatDateTime } from '@/utils/format'

const store = useTournamentStore()

const stageFilter = ref('all')
const statusFilter = ref('all')
const groupFilter = ref('all')
const detailMatch = ref(null)
const entryMatch = ref(null)

const stageOptions = [
  { value: 'all', label: '全部阶段' },
  { value: 'group', label: '小组赛' },
  { value: 'qf', label: '八强' },
  { value: 'sf', label: '半决赛' },
  { value: 'final', label: '决赛' },
]

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '未开始' },
  { value: 'complete', label: '已完赛' },
  { value: 'forfeit', label: '判负' },
  { value: 'overdue', label: '逾期' },
  { value: 'walkover', label: '直接晋级' },
]

const rows = computed(() => {
  return store.matches
    .filter((m) => {
      const matchStage = m.stage
      const ddl = store.ddlForMatch(m)
      const overdue = m.status === 'pending' && ddl && new Date(ddl).getTime() < Date.now()
      const displayStatus = overdue ? 'overdue' : m.status
      const matchStageOk = stageFilter.value === 'all' || matchStage === stageFilter.value
      const matchStatusOk = statusFilter.value === 'all' || displayStatus === statusFilter.value
      const groupOk =
        groupFilter.value === 'all' ||
        (matchStage === 'group' && m.groupId === groupFilter.value)
      return matchStageOk && matchStatusOk && groupOk
    })
    .map((match) => {
      const ddl = store.ddlForMatch(match)
      const overdue = match.status === 'pending' && ddl && new Date(ddl).getTime() < Date.now()
      return { match, ddl, overdue }
    })
    .sort((a, b) => a.match.stage.localeCompare(b.match.stage) || (a.match.order || 0) - (b.match.order || 0) || a.match.id.localeCompare(b.match.id))
})

function stageLabel(match) {
  if (match.stage === 'group') return `${match.groupId}组${match.round}`
  if (match.stage === 'final') return '决赛'
  return `${store.STAGE_LABELS[match.stage]}${match.order ?? ''}`
}

function displayStatus(row) {
  return row.overdue ? 'overdue' : row.match.status
}

function forfeit(row, decision) {
  const match = row.match
  const labels = {
    A: `${store.playerName(match.playerAId)}负`,
    B: `${store.playerName(match.playerBId)}负`,
    both: '双方负',
    extend: '延期',
  }
  if (
    window.confirm(
      `确认对 ${store.playerName(match.playerAId)} vs ${store.playerName(match.playerBId)} 执行「${labels[decision]}」？`,
    )
  ) {
    store.forfeitMatch(match.id, decision)
  }
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-7xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">赛果录入</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        小组赛 BO3（先 2 局）· 淘汰赛 BO5（先 3 局）· 平局需选择 SD 胜者
      </p>
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <select
        v-model="stageFilter"
        class="rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 text-sm dark:border-[#454545] dark:bg-[#333333]"
      >
        <option v-for="opt in stageOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <select
        v-if="stageFilter === 'group' || stageFilter === 'all'"
        v-model="groupFilter"
        class="rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 text-sm dark:border-[#454545] dark:bg-[#333333]"
      >
        <option value="all">全部小组</option>
        <option v-for="g in ['A', 'B', 'C', 'D']" :key="g" :value="g">{{ g }}组</option>
      </select>
      <select
        v-model="statusFilter"
        class="rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 text-sm dark:border-[#454545] dark:bg-[#333333]"
      >
        <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="notion-card">
      <div class="hidden overflow-x-auto lg:block">
      <table class="hover-gold notion-table w-full text-sm">
        <thead>
          <tr class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]">
            <th class="w-20 px-4 py-3">阶段</th>
            <th class="px-4 py-3">对阵</th>
            <th class="px-4 py-3">比分</th>
            <th class="px-4 py-3">DDL</th>
            <th class="px-4 py-3">状态</th>
            <th class="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ match, ddl, overdue } in rows"
            :key="match.id"
            class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
            :class="overdue ? 'rounded-lg bg-[#fdecec] dark:bg-[#2a1a1a]' : ''"
          >
            <td class="whitespace-nowrap px-4 py-3 text-[#5d5b54] dark:text-[#a0a0a0]">{{ stageLabel(match) }}</td>
            <td class="px-4 py-3">
              <div class="grid w-full min-w-[240px] grid-cols-[1fr_auto_1fr] items-center gap-2">
                <PlayerBadge :player="store.playerById(match.playerAId)" size="sm" />
                <span class="text-center text-[#a4a097]">vs</span>
                <PlayerBadge
                  :player="store.playerById(match.playerBId)"
                  size="sm"
                  reverse
                  class="justify-self-end"
                />
              </div>
            </td>
            <td class="whitespace-nowrap px-4 py-3 font-bold">
              {{
                match.status === 'complete'
                  ? `${store.matchScore(match).a} : ${store.matchScore(match).b}`
                  : match.status === 'forfeit'
                    ? '判负'
                    : '-'
              }}
            </td>
            <td class="whitespace-nowrap px-4 py-3 text-xs text-[#5d5b54] dark:text-[#a0a0a0]">
              {{ formatDateTime(ddl) }}
            </td>
            <td class="px-4 py-3">
              <MatchStatusPill :status="displayStatus({ match, overdue })" />
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-1 whitespace-nowrap">
                <BaseButton label="查看" color="whiteDark" small @click="detailMatch = match" />
                <BaseButton
                  label="录入/编辑"
                  color="purple"
                  small
                  @click="entryMatch = match"
                />
                <template v-if="match.status === 'pending'">
                  <BaseButton
                    :label="`${store.playerName(match.playerAId)}负`"
                    color="danger"
                    small
                    :disabled="!store.canJudgeForfeit(match, 'A')"
                    @click="forfeit({ match }, 'A')"
                  />
                  <BaseButton
                    :label="`${store.playerName(match.playerBId)}负`"
                    color="danger"
                    small
                    :disabled="!store.canJudgeForfeit(match, 'B')"
                    @click="forfeit({ match }, 'B')"
                  />
                  <BaseButton
                    label="双方负"
                    color="warning"
                    small
                    :disabled="!store.canJudgeForfeit(match, 'both')"
                    @click="forfeit({ match }, 'both')"
                  />
                  <BaseButton label="延期" color="whiteDark" small @click="forfeit({ match }, 'extend')" />
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="6" class="px-4 py-8 text-center text-[#a4a097]">没有符合条件的比赛</td>
          </tr>
        </tbody>
      </table>
      </div>
      <div class="divide-y divide-[#ede9e4] lg:hidden dark:divide-[#2e2e2e]">
        <div
          v-for="{ match, ddl, overdue } in rows"
          :key="match.id"
          class="p-4"
          :class="overdue ? 'rounded-lg bg-[#fdecec] dark:bg-[#2a1a1a]' : ''"
        >
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="text-xs font-semibold text-[#5d5b54] dark:text-[#a0a0a0]">
              {{ stageLabel(match) }}
            </span>
            <MatchStatusPill :status="displayStatus({ match, overdue })" />
          </div>
          <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <PlayerBadge :player="store.playerById(match.playerAId)" size="sm" />
            <span class="text-center text-[#a4a097]">vs</span>
            <PlayerBadge
              :player="store.playerById(match.playerBId)"
              size="sm"
              reverse
              class="justify-self-end"
            />
          </div>
          <div
            class="mt-2 flex items-center justify-between gap-2 text-xs text-[#5d5b54] dark:text-[#a0a0a0]"
          >
            <span>
              比分
              <b class="text-[#1a1a1a] dark:text-[#e6e6e6]">{{
                match.status === 'complete'
                  ? `${store.matchScore(match).a} : ${store.matchScore(match).b}`
                  : match.status === 'forfeit'
                    ? '判负'
                    : '-'
              }}</b>
            </span>
            <span>{{ formatDateTime(ddl) }}</span>
          </div>
          <div class="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <BaseButton
              label="查看"
              color="whiteDark"
              small
              class="justify-self-end"
              @click="detailMatch = match"
            />
            <BaseButton label="录入/编辑" color="purple" small @click="entryMatch = match" />
            <BaseButton
              v-if="match.status === 'pending'"
              label="延期"
              color="whiteDark"
              small
              class="justify-self-start"
              @click="forfeit({ match }, 'extend')"
            />
          </div>
          <div v-if="match.status === 'pending'" class="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <BaseButton
              :label="`${store.playerName(match.playerAId)}负`"
              color="danger"
              small
              class="justify-self-end"
              :disabled="!store.canJudgeForfeit(match, 'A')"
              @click="forfeit({ match }, 'A')"
            />
            <BaseButton
              label="双方负"
              color="warning"
              small
              :disabled="!store.canJudgeForfeit(match, 'both')"
              @click="forfeit({ match }, 'both')"
            />
            <BaseButton
              :label="`${store.playerName(match.playerBId)}负`"
              color="danger"
              small
              class="justify-self-start"
              :disabled="!store.canJudgeForfeit(match, 'B')"
              @click="forfeit({ match }, 'B')"
            />
          </div>
        </div>
        <div v-if="!rows.length" class="p-6 text-center text-sm text-[#a4a097]">
          没有符合条件的比赛
        </div>
      </div>
    </div>

    <MatchDetailModal v-if="detailMatch" :match="detailMatch" @close="detailMatch = null" />
    <ScoreEntryModal
      v-if="entryMatch"
      :match="entryMatch"
      @close="entryMatch = null"
      @saved="entryMatch = null"
    />
  </div>
</template>
