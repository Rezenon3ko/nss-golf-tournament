<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { siteName } from '@/config'
import {
  mdiMenu,
  mdiClose,
  mdiLock,
  mdiLogout,
  mdiViewDashboard,
  mdiWhiteBalanceSunny,
  mdiWeatherNight,
} from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'
import GolfLogo from '@/components/GolfLogo.vue'
import { useDarkModeStore } from '@/stores/darkMode'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const darkModeStore = useDarkModeStore()
const mobileOpen = ref(false)

const navItems = [
  { to: '/', label: '首页', exact: true },
  { to: '/groups', label: '小组赛' },
  { to: '/standings', label: '积分榜' },
  { to: '/bracket', label: '淘汰赛' },
  { to: '/players', label: '选手' },
  { to: '/rules', label: '规则' },
]

function isActive(item) {
  if (item.exact) return route.path === '/'
  return route.path.startsWith(item.to)
}

// 导航项统一样式：登录/后台/退出与其它导航项保持同一套排版。
// 高度写死（桌面 h-9 / 移动 h-10），这样纯文字项、带图标的项、以及右侧 h-9 的图标按钮完全等高。
const navItemClass =
  'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors'
const navItemClassMobile =
  'flex h-10 items-center gap-1.5 rounded-md px-3 text-sm transition-colors'
// 图标外层收成 16px：BaseIcon 默认外层是 24px，会把带图标的行撑高 4px
const navIconClass = { w: 'w-4', h: 'h-4' }
const navIdleClass =
  'text-[#5d5b54] hover:bg-[#f0eeec] hover:text-black dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d] dark:hover:text-slate-100'
const navActiveClass =
  'bg-[#c9a24b]/25 font-semibold text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4]'

function logout() {
  auth.logout()
  router.push('/')
}

function logoutFromMobile() {
  mobileOpen.value = false
  logout()
}
</script>

<template>
  <div class="notion-body flex min-h-screen flex-col">
    <header class="notion-nav sticky top-0 z-40 backdrop-blur">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <RouterLink to="/" class="flex items-center gap-2 font-bold">
          <GolfLogo :size="32" />
          <span class="text-[#37352f] dark:text-[#e6e6e6]">{{ siteName }}</span>
        </RouterLink>

        <nav class="hidden items-center gap-1 md:flex">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :class="[navItemClass, isActive(item) ? navActiveClass : navIdleClass]"
          >
            {{ item.label }}
          </RouterLink>
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
            <template v-if="auth.isAdmin">
              <RouterLink
                to="/admin"
                :class="[
                  navItemClass,
                  route.path.startsWith('/admin') ? navActiveClass : navIdleClass,
                ]"
              >
                <BaseIcon :path="mdiViewDashboard" size="16" v-bind="navIconClass" />
                主办方后台
              </RouterLink>
              <button type="button" :class="[navItemClass, navIdleClass]" @click="logout">
                <BaseIcon :path="mdiLogout" size="16" v-bind="navIconClass" />
                退出
              </button>
            </template>
            <RouterLink
              v-else
              :to="{ name: 'login', query: { next: route.fullPath } }"
              :class="[navItemClass, navIdleClass]"
            >
              <BaseIcon :path="mdiLock" size="16" v-bind="navIconClass" />
              主办方登录
            </RouterLink>
          </div>
        </nav>

        <div class="flex items-center gap-1 md:hidden">
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
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#787671] hover:bg-[#f0eeec] dark:text-[#c7c7c7] dark:hover:bg-[#3d3d3d]"
            @click="mobileOpen = !mobileOpen"
          >
            <BaseIcon :path="mobileOpen ? mdiClose : mdiMenu" size="24" />
          </button>
        </div>
      </div>

      <nav
        v-if="mobileOpen"
        class="border-t border-[#e5e3df] bg-white px-4 pb-4 md:hidden dark:border-[#3d3d3d] dark:bg-[#1e1e1e]"
      >
        <div class="flex flex-col gap-1 py-2">
          <RouterLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            :class="[navItemClassMobile, isActive(item) ? navActiveClass : navIdleClass]"
            @click="mobileOpen = false"
          >
            {{ item.label }}
          </RouterLink>
        </div>
        <div class="flex flex-col gap-1 border-t border-[#e5e3df] pt-2 dark:border-[#3d3d3d]">
          <template v-if="auth.isAdmin">
            <RouterLink
              to="/admin"
              :class="[
                navItemClassMobile,
                route.path.startsWith('/admin') ? navActiveClass : navIdleClass,
              ]"
              @click="mobileOpen = false"
            >
              <BaseIcon :path="mdiViewDashboard" size="16" v-bind="navIconClass" />
              主办方后台
            </RouterLink>
            <button
              type="button"
              :class="[navItemClassMobile, navIdleClass]"
              @click="logoutFromMobile"
            >
              <BaseIcon :path="mdiLogout" size="16" v-bind="navIconClass" />
              退出
            </button>
          </template>
          <RouterLink
            v-else
            :to="{ name: 'login', query: { next: route.fullPath } }"
            :class="[navItemClassMobile, navIdleClass]"
            @click="mobileOpen = false"
          >
            <BaseIcon :path="mdiLock" size="16" v-bind="navIconClass" />
            主办方登录
          </RouterLink>
        </div>
      </nav>
    </header>

    <main class="flex-1">
      <RouterView />
    </main>

    <footer
      class="border-t border-[#e5e3df] py-6 text-center text-xs text-[#a4a097] dark:border-[#3d3d3d] dark:text-[#757575]"
    >
      <div class="mx-auto max-w-6xl px-4">
        <p>© 2026 {{ siteName }} · 数据仅供赛事记录，截图与录屏由主办方留存</p>
        <p class="mt-1">
          基于
          <a
            href="https://justboil.me/tailwind-admin-templates/free-vue-dashboard/"
            target="_blank"
            rel="noopener"
            class="underline"
          >
            Admin One Tailwind Vue 3
          </a>
          （MIT）构建
        </p>
      </div>
    </footer>
  </div>
</template>
