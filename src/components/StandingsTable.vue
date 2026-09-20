<script setup>
import { computed } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import PlayerBadge from '@/components/PlayerBadge.vue'
import BaseButton from '@/components/BaseButton.vue'
import { useFeedbackStore } from '@/stores/feedback'
import { groupRowClass, groupRowHoverClass } from '@/lib/groupColors'
import { mdiDiceMultiple } from '@mdi/js'

const props = defineProps({
  groupId: {
    type: String,
    required: true,
  },
})

const store = useTournamentStore()
const auth = useAuthStore()
const feedback = useFeedbackStore()

const rows = computed(() => store.getStandings(props.groupId))

// 前两名（出线）行背景与悬停：统一取自 lib/groupColors
const tintBg = computed(() => groupRowClass(props.groupId))
const tintHover = computed(() => groupRowHoverClass(props.groupId))
const complete = computed(() => !!store.groupComplete[props.groupId])
const hasDraw = computed(() => rows.value.some((row) => row.needsDraw))

async function resolveDraw() {
  const names = rows.value
    .filter((row) => row.needsDraw)
    .map((row) => row.name)
    .join('、')
  const ok = await feedback.confirm({
    title: `${props.groupId} 组并列抽签`,
    message: `按规则顺序（积分 → 相互战绩 → 净胜局 → 净胜杆）仍无法区分 ${names}，是否发起随机抽签决定名次？`,
    confirmLabel: '发起抽签',
  })
  if (!ok) return
  store.resolveTiebreak(props.groupId)
  feedback.success(`${props.groupId} 组并列名次已抽签确定`)
}

function rankClass(rank) {
  if (rank === 1) {
    return 'bg-[#f7e7b0] text-[#241a08]'
  }
  if (rank === 2) {
    return 'bg-[#e8eaee] text-[#4a5168]'
  }
  return 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]'
}
</script>

<template>
  <div>
    <div class="notion-card">
      <div class="hidden overflow-x-auto lg:block">
      <table class="notion-table w-full table-fixed text-base">
        <thead>
          <tr class="border-b border-[#e5e3df] text-left text-sm text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]">
            <th class="w-16 px-4 py-3">排名</th>
            <th class="w-48 px-4 py-3">选手</th>
            <th class="w-20 px-4 py-3">场</th>
            <th class="w-20 px-4 py-3">胜</th>
            <th class="w-20 px-4 py-3">负</th>
            <th class="w-20 px-4 py-3">积分</th>
            <th class="w-20 px-4 py-3">净胜局</th>
            <th class="w-20 px-4 py-3">净胜杆</th>
            <th class="w-20 px-4 py-3">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.playerId"
            class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
            :class="[row.rank <= 2 ? tintBg : '', tintHover]"
          >
            <td class="px-4 py-3">
              <span
                class="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
                :class="rankClass(row.rank)"
              >
                {{ row.rank }}
              </span>
            </td>
            <td class="px-4 py-3">
              <PlayerBadge :player="store.playerById(row.playerId)" />
            </td>
            <td class="px-4 py-3">{{ row.played }}</td>
            <td class="px-4 py-3">{{ row.wins }}</td>
            <td class="px-4 py-3">{{ row.losses }}</td>
            <td class="px-4 py-3 font-bold">{{ row.points }}</td>
            <td class="px-4 py-3">{{ row.setDiff > 0 ? `+${row.setDiff}` : row.setDiff }}</td>
            <td class="px-4 py-3">{{ row.strokeDiff > 0 ? `+${row.strokeDiff}` : row.strokeDiff }}</td>
            <td class="px-4 py-3">
              <span
                v-if="complete && row.rank <= 2"
                class="rounded-full bg-[#d9f3e1] px-2 py-0.5 text-sm font-semibold text-[#1aae39] dark:bg-[#1d3a2a] dark:text-[#7ec8a0]"
              >
                🏆 晋级
              </span>
              <span
                v-else-if="row.needsDraw"
                class="rounded-full bg-amber-100 px-2 py-0.5 text-sm font-semibold text-[#793400] dark:bg-[#3a2f1a] dark:text-[#d9bf7e]"
              >
                待抽签
              </span>
              <span v-else class="text-sm text-[#a4a097]">-</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div class="lg:hidden">
        <div
          v-for="row in rows"
          :key="row.playerId"
          class="border-b border-[#ede9e4] p-4 last:border-0 dark:border-[#2e2e2e]"
          :class="[row.rank <= 2 ? tintBg : '', tintHover]"
        >
          <div class="flex items-center gap-3">
            <span
              class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              :class="rankClass(row.rank)"
            >
              {{ row.rank }}
            </span>
            <PlayerBadge
              :player="store.playerById(row.playerId)"
              size="sm"
              truncate
              class="min-w-0 flex-1"
            />
            <span class="shrink-0 text-base font-bold">{{ row.points }} 分</span>
          </div>
          <div class="mt-1 flex items-center justify-between gap-2 pl-10 text-sm font-medium text-[#5d5b54] dark:text-[#c7c7c7]">
            <span>
              胜{{ row.wins }} 负{{ row.losses }} · 净胜局{{
                row.setDiff > 0 ? `+${row.setDiff}` : row.setDiff
              }} · 净胜杆{{ row.strokeDiff > 0 ? `+${row.strokeDiff}` : row.strokeDiff }}
            </span>
            <span
              v-if="complete && row.rank <= 2"
              class="shrink-0 font-semibold text-[#1aae39] dark:text-[#7ec8a0]"
            >
              🏆 晋级
            </span>
            <span
              v-else-if="row.needsDraw"
              class="shrink-0 font-semibold text-[#dd5b00] dark:text-[#d9bf7e]"
            >
              待抽签
            </span>
          </div>
        </div>
        <div v-if="!rows.length" class="p-6 text-center text-sm text-[#a4a097]">暂无数据</div>
      </div>
    </div>

    <div v-if="hasDraw" class="mt-3 flex flex-wrap items-center gap-3">
      <p class="text-sm text-[#793400] dark:text-[#d9bf7e]">
        按规则顺序（积分 → 相互战绩 → 净胜局 → 净胜杆）仍无法区分，需由主办方随机抽签。
      </p>
      <BaseButton
        v-if="auth.isAdmin"
        :icon="mdiDiceMultiple"
        label="发起随机抽签"
        color="warning"
        small
        @click="resolveDraw"
      />
    </div>
  </div>
</template>
