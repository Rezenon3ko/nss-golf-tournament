<script setup>
import { RouterView } from 'vue-router'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import BaseIcon from '@/components/BaseIcon.vue'
import GolfLogo from '@/components/GolfLogo.vue'

const tournamentStore = useTournamentStore()
const authStore = useAuthStore()

// 数据与登录会话初始化；若已是主办方（会话恢复），把本地数据同步到云端
Promise.all([tournamentStore.init(), authStore.init()]).then(() => {
  if (authStore.isAdmin) {
    tournamentStore.ensureCloudSync()
  }
})
</script>

<template>
  <!-- 数据就绪前显示加载页，避免“未抽签”空状态闪烁 -->
  <div
    v-if="!tournamentStore.ready"
    class="fixed inset-0 z-[100] flex items-center justify-center bg-white dark:bg-linear-to-br dark:from-[#121212] dark:to-[#121212]"
  >
    <div class="flex flex-col items-center gap-3">
      <GolfLogo :size="56" class="animate-pulse" />
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">正在加载赛事数据…</p>
    </div>
  </div>
  <RouterView v-else />
</template>
