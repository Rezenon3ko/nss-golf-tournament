<script setup>
import { watch } from 'vue'
import { RouterView } from 'vue-router'
import { prefetchRoutesWhenIdle } from '@/router'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import GolfLogo from '@/components/GolfLogo.vue'
import SyncBanner from '@/components/SyncBanner.vue'
import ToastHost from '@/components/ToastHost.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const tournamentStore = useTournamentStore()
const authStore = useAuthStore()

// 数据与登录会话初始化。
// 只有主办方登录后才允许写云端；首次登录会把待同步的改动推上去，
// 不会再无条件覆盖云端数据（覆盖前有版本校验）。
Promise.all([tournamentStore.init(), authStore.init()]).then(() => {
  tournamentStore.setCloudWriteEnabled(authStore.isAdmin)
})

watch(
  () => authStore.isAdmin,
  (isAdmin) => {
    tournamentStore.setCloudWriteEnabled(isAdmin)
    // 登录后空闲时预取管理端页面，录赛果、改 DDL 时不必再等 chunk
    if (isAdmin) prefetchRoutesWhenIdle('admin')
  },
  { immediate: true },
)
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
  <template v-else>
    <RouterView />
    <ToastHost />
    <ConfirmDialog />
    <SyncBanner />
  </template>
</template>
