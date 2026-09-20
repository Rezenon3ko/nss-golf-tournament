<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menuAsideMain, menuAsideBottom } from '@/menuAside.js'
import { useDarkModeStore } from '@/stores/darkMode.js'
import { useAuthStore } from '@/stores/auth.js'
import { useMainStore } from '@/stores/main.js'
import { useTournamentStore } from '@/stores/tournament.js'
import { siteName } from '@/config.js'
import BaseIcon from '@/components/BaseIcon.vue'
import GolfLogo from '@/components/GolfLogo.vue'
import {
  mdiMenu,
  mdiClose,
  mdiLogout,
  mdiEye,
  mdiWhiteBalanceSunny,
  mdiWeatherNight,
} from '@mdi/js'

const route = useRoute()
const router = useRouter()
const darkModeStore = useDarkModeStore()
const authStore = useAuthStore()
const mainStore = useMainStore()
const tournamentStore = useTournamentStore()

const sidebarOpen = ref(false)

function go(item) {
  if (item.to) {
    router.push(item.to)
  }
  if (item.isToggleLightDark) {
    darkModeStore.set(null, true)
  }
  if (item.isLogout) {
    authStore.logout()
    router.push('/')
  }
  sidebarOpen.value = false
}

function logout() {
  authStore.logout()
  router.push('/')
}
</script>

<template>
  <div class="notion-body min-h-screen">
    <!-- 顶栏 -->
    <header class="notion-nav fixed inset-x-0 top-0 z-40 h-14">
      <div class="flex h-14 items-center justify-between px-4">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#787671] hover:bg-[#f0eeec] lg:hidden dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]"
            @click="sidebarOpen = !sidebarOpen"
          >
            <BaseIcon :path="sidebarOpen ? mdiClose : mdiMenu" size="24" />
          </button>
          <span class="flex items-center gap-2 font-bold">
            <GolfLogo :size="32" />
            <span class="text-[#37352f] dark:text-[#e6e6e6]"><span class="hidden sm:inline">{{ siteName }} · </span>主办方后台</span>
          </span>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#c9a24b]/25 text-[#8c6d1f] hover:bg-[#c9a24b]/40 dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4] dark:hover:bg-[#c9a24b]/40"
            :title="darkModeStore.isEnabled ? '切换到浅色模式' : '切换到深色模式'"
            @click="darkModeStore.set(null, true)"
          >
            <BaseIcon
              :path="darkModeStore.isEnabled ? mdiWhiteBalanceSunny : mdiWeatherNight"
              size="20"
            />
          </button>
          <RouterLink
            to="/"
            class="inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm text-[#5d5b54] hover:bg-[#f0eeec] hover:text-black dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]"
          >
            <BaseIcon :path="mdiEye" size="18" />
            <span class="hidden sm:inline">查看前台</span>
          </RouterLink>
          <div
            class="flex items-center gap-2 rounded-full bg-[#f0eeec] py-1 pl-1 pr-1 dark:bg-[#333333] sm:pr-3"
          >
            <img
              v-if="tournamentStore.adminAvatar"
              :src="tournamentStore.adminAvatar"
              :alt="mainStore.userName"
              class="h-7 w-7 rounded-full object-cover"
            />
            <span
              v-else
              class="flex h-7 w-7 items-center justify-center rounded-full bg-[#c9a24b]/25 text-xs font-bold text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4]"
            >
              {{ mainStore.userName.slice(0, 1) }}
            </span>
            <span class="hidden text-sm font-semibold sm:inline">{{ mainStore.userName }}</span>
          </div>
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#787671] hover:bg-[#f0eeec] dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]"
            title="退出登录"
            @click="logout"
          >
            <BaseIcon :path="mdiLogout" size="20" />
          </button>
        </div>
      </div>
    </header>

    <!-- 侧边栏 -->
    <aside
      class="fixed inset-y-0 left-0 z-30 w-60 border-r border-[#e5e3df] bg-white pt-14 transition-transform lg:translate-x-0 dark:border-[#3d3d3d] dark:bg-[#1e1e1e]"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <nav class="flex h-full flex-col overflow-y-auto p-3">
        <div class="space-y-1">
          <RouterLink
            v-for="item in menuAsideMain"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm"
            :class="
              route.path === item.to
                ? 'bg-[#c9a24b]/25 font-semibold text-[#8c6d1f] dark:bg-[#333333] dark:text-[#c4bcd4]'
                : 'text-[#5d5b54] hover:bg-[#f0eeec] hover:text-black dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d] dark:hover:text-slate-100'
            "
            @click="sidebarOpen = false"
          >
            <BaseIcon :path="item.icon" size="20" />
            {{ item.label }}
          </RouterLink>
        </div>
        <div
          class="mt-auto space-y-1 border-t border-[#e5e3df] pt-3 dark:border-[#3d3d3d]"
        >
          <button
            v-for="item in menuAsideBottom"
            :key="item.label"
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[#5d5b54] hover:bg-[#f0eeec] hover:text-black dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d] dark:hover:text-slate-100"
            @click="go(item)"
          >
            <BaseIcon :path="item.icon" size="20" />
            {{ item.label }}
          </button>
        </div>
      </nav>
    </aside>

    <!-- 移动端遮罩 -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-20 bg-black/40 lg:hidden dark:bg-[#1e1e1e]/50"
      @click="sidebarOpen = false"
    ></div>

    <!-- 内容 -->
    <div class="pt-14 lg:pl-60">
      <RouterView />
    </div>

    <footer
      class="border-t border-[#e5e3df] py-4 text-center text-xs text-[#a4a097] lg:pl-60 dark:border-[#3d3d3d] dark:text-[#757575]"
    >
      © 2026 {{ siteName }} · 基于 Admin One Tailwind Vue 3（MIT）构建
    </footer>
  </div>
</template>
