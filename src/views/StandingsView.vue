<script setup>
import { useTournamentStore, GROUPS } from '@/stores/tournament'
import { groupChipClass } from '@/lib/groupColors'

const store = useTournamentStore()
import StandingsTable from '@/components/StandingsTable.vue'
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div class="mb-6">
      <h1 class="text-2xl font-bold">积分榜</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        排名规则：积分 → 相互战绩 → 净胜局数 → 净胜杆数 → 主办方随机抽签
      </p>
    </div>

    <div v-for="g in GROUPS" :key="g" class="mb-8">
      <h2 class="mb-2 flex items-center gap-2 text-lg font-bold">
        {{ g }} 组
        <span class="rounded-full px-2 py-0.5 text-xs font-semibold" :class="groupChipClass(g)">
          {{ store.groupComplete[g] ? '已结束' : '小组赛进行中' }}
        </span>
      </h2>
      <StandingsTable :group-id="g" />
    </div>
  </div>
</template>
