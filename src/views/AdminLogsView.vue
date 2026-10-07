<script setup>
import { useTournamentStore } from '@/stores/tournament'
import { formatDateTime } from '@/utils/format'

const store = useTournamentStore()
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">日志记录</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">主办方关键操作自动留痕 · 全程可追溯</p>
    </div>

    <div class="notion-card p-5">
      <div class="mb-3 flex items-baseline justify-between gap-3">
        <h2 class="font-bold">操作日志</h2>
        <span class="text-xs text-[#a4a097]">共 {{ store.logs.length }} 条</span>
      </div>
      <ul
        class="flex max-h-[65vh] flex-col gap-1 overflow-y-auto text-sm text-[#37352f] dark:text-[#c7c7c7]"
      >
        <li v-for="log in store.logs" :key="log.id" class="flex gap-2">
          <span class="shrink-0 text-xs text-[#a4a097]">{{ formatDateTime(log.time) }}</span>
          <span class="shrink-0 font-semibold">{{ log.by }}</span>
          <span>{{ log.message }}</span>
        </li>
        <li v-if="!store.logs.length" class="text-[#a4a097]">暂无日志</li>
      </ul>
    </div>
  </div>
</template>
