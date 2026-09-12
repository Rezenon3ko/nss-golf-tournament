<script setup>
import { useTournamentStore, GROUPS } from '@/stores/tournament'

const store = useTournamentStore()
import StandingsTable from '@/components/StandingsTable.vue'

// 与首页积分榜卡片同款组色
const groupTint = {
  A: 'bg-[#e6e0f5] text-[#37352f] dark:bg-[#7469a6] dark:text-[#cfc8e0]',
  B: 'bg-[#d9f3e1] text-[#37352f] dark:bg-[#6b7f72] dark:text-[#c8dccf]',
  C: 'bg-[#dcecfa] text-[#37352f] dark:bg-[#6b7890] dark:text-[#c8d6e6]',
  D: 'bg-[#ffe8d4] text-[#37352f] dark:bg-[#8c7363] dark:text-[#e6d8ca]',
}
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
        <span
          class="rounded-full px-2 py-0.5 text-xs font-semibold"
          :class="groupTint[g]"
        >
          {{ store.groupComplete[g] ? '已结束' : '小组赛进行中' }}
        </span>
      </h2>
      <StandingsTable :group-id="g" />
    </div>
  </div>
</template>
