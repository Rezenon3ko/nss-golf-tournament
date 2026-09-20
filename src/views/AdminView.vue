<script setup>
import { computed } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import BaseIcon from '@/components/BaseIcon.vue'
import BaseButton from '@/components/BaseButton.vue'
import {
  mdiAccountGroup,
  mdiGolf,
  mdiCalendarClock,
  mdiFolderImage,
  mdiExport,
  mdiAlertCircle,
  mdiClipboardCheck,
} from '@mdi/js'

const store = useTournamentStore()

const cards = [
  {
    to: '/admin/players',
    icon: mdiAccountGroup,
    title: '选手与分组',
    desc: '管理名单、档位、抽签分组',
  },
  { to: '/admin/matches', icon: mdiGolf, title: '赛果录入', desc: '录入 BO3 / BO5 成绩与截图' },
  { to: '/admin/ddl', icon: mdiCalendarClock, title: 'DDL 与逾期', desc: '设置截止时间、逾期判负' },
  { to: '/admin/evidence', icon: mdiFolderImage, title: '证据与日志', desc: '截图留档、操作追溯' },
  { to: '/admin/export', icon: mdiExport, title: '数据导出', desc: 'CSV / JSON / 群通知文案' },
]

const todos = computed(() => {
  const list = []
  const published = store.players.some((p) => p.groupId)
  if (!published) {
    list.push({ type: 'warn', text: '分组尚未发布，赛程未生成', to: '/admin/players' })
  }
  const pending = store.matches.filter((m) => m.status === 'pending').length
  if (pending > 0) {
    list.push({ type: 'info', text: `${pending} 场比赛待完成 / 待录入`, to: '/admin/matches' })
  }
  if (store.overdueMatches.length > 0) {
    list.push({
      type: 'danger',
      text: `${store.overdueMatches.length} 场已逾期，等待裁决`,
      to: '/admin/ddl',
    })
  }
  for (const g of ['A', 'B', 'C', 'D']) {
    if (store.getStandings(g).some((r) => r.needsDraw)) {
      list.push({ type: 'warn', text: `${g}组存在并列排名，需随机抽签`, to: '/admin/matches' })
    }
  }
  if (!list.length) {
    list.push({ type: 'ok', text: '一切正常，暂无待办', to: null })
  }
  return list
})
</script>

<template>
  <div class="p-6" :class="'xl:mx-auto xl:max-w-6xl'">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">主办方后台</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        当前赛事状态：{{
          store.stage === 'setup'
            ? '未开始（待抽签分组）'
            : store.stage === 'group'
              ? '小组赛进行中'
              : store.stage === 'finished'
                ? '已完赛'
                : '淘汰赛进行中'
        }}
      </p>
    </div>

    <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink
        v-for="card in cards"
        :key="card.to"
        :to="card.to"
        class="group notion-card card-hover-gold p-5 transition hover:shadow-md"
      >
        <BaseIcon
          :path="card.icon"
          size="26"
          class="mb-3 text-[#c9a24b] transition-transform group-hover:scale-110 dark:text-[#d8c48a]"
        />
        <p class="font-bold">{{ card.title }}</p>
        <p class="mt-1 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">{{ card.desc }}</p>
      </RouterLink>
    </div>

    <div class="notion-card p-5">
      <div
        class="mb-3 flex items-center gap-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]"
      >
        <BaseIcon :path="mdiClipboardCheck" size="18" />
        待办
      </div>
      <div class="flex flex-col gap-2">
        <div
          v-for="(todo, i) in todos"
          :key="i"
          class="notion-card-soft flex items-center justify-between px-4 py-3 text-sm"
        >
          <span class="flex items-center gap-2">
            <BaseIcon
              :path="mdiAlertCircle"
              size="16"
              :class="
                todo.type === 'danger'
                  ? 'text-[#e03131]'
                  : todo.type === 'warn'
                    ? 'text-[#dd5b00]'
                    : 'text-[#c9a24b] dark:text-[#d8c48a]'
              "
            />
            {{ todo.text }}
          </span>
          <BaseButton v-if="todo.to" :to="todo.to" label="去处理" color="whiteDark" small />
        </div>
      </div>
    </div>
  </div>
</template>
