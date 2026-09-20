<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import { useFeedbackStore } from '@/stores/feedback'
import BaseButton from '@/components/BaseButton.vue'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiAlertCircle, mdiCloudAlert, mdiCloudSync, mdiSync } from '@mdi/js'

const store = useTournamentStore()
const auth = useAuthStore()
const feedback = useFeedbackStore()
const sync = store.sync

const isAdmin = computed(() => auth.isAdmin)
const toast = ref('')
const showSaving = ref(false)
const busy = ref(false)
let toastTimer = null
let savingTimer = null

// 只在同步真正花时间时才提示，避免每次操作都闪一下
watch(
  () => sync.status,
  (next, prev) => {
    if (prev === 'saving' && next === 'idle') showToast('赛事数据已同步到云端')
    clearTimeout(savingTimer)
    if (next === 'saving') {
      savingTimer = setTimeout(() => {
        showSaving.value = true
      }, 500)
    } else {
      showSaving.value = false
    }
  },
)

onBeforeUnmount(() => {
  clearTimeout(savingTimer)
  clearTimeout(toastTimer)
})

function showToast(text) {
  toast.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 2500)
}

const conflict = computed(() => sync.status === 'conflict')
const failed = computed(() => sync.status === 'error')
const degraded = computed(() => sync.degraded)
// 数据库还没执行新版 schema.sql：仍能写入，但没有版本校验
const legacyWrite = computed(() => sync.mode === 'cloud' && !sync.supportsRevision && isAdmin.value)

const visible = computed(
  () =>
    conflict.value ||
    degraded.value ||
    failed.value ||
    legacyWrite.value ||
    (isAdmin.value && showSaving.value),
)

async function run(action) {
  busy.value = true
  try {
    await action()
  } finally {
    busy.value = false
  }
}

async function keepLocal() {
  const ok = await feedback.confirm({
    title: '用本机版本覆盖云端',
    message: '云端当前的赛果将被本页内容替换，且无法撤销。确认继续？',
    confirmLabel: '覆盖云端',
    danger: true,
  })
  if (ok) run(() => store.useLocalVersion())
}

async function keepRemote() {
  const ok = await feedback.confirm({
    title: '采用云端版本',
    message: '本机尚未同步的改动会被丢弃，确认继续？',
    confirmLabel: '采用云端',
    danger: true,
  })
  if (ok) store.useRemoteVersion()
}

function reloadPage() {
  window.location.reload()
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-3 bottom-3 z-[90] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96"
    role="status"
    aria-live="polite"
  >
    <p
      v-if="toast"
      class="pointer-events-auto flex items-center gap-2 rounded-full bg-[#1aae39] px-4 py-2 text-sm font-medium text-white shadow-lg"
    >
      <BaseIcon :path="mdiCloudSync" size="16" />
      {{ toast }}
    </p>

    <div
      v-if="visible"
      class="pointer-events-auto w-full rounded-xl border p-4 text-sm shadow-[rgba(15,15,15,0.16)_0px_16px_48px_-8px]"
      :class="
        conflict || legacyWrite
          ? 'border-[#f0d9a0] bg-[#fef7d6] text-[#793400] dark:border-[#5c4a1e] dark:bg-[#2b2415] dark:text-[#e6d5a8]'
          : failed || degraded
            ? 'border-[#f3c2c2] bg-[#fdecec] text-[#a12222] dark:border-[#5c2b2b] dark:bg-[#3d2020] dark:text-[#f0b4b4]'
            : 'border-[#e5e3df] bg-white text-[#5d5b54] dark:border-[#3d3d3d] dark:bg-[#1e1e1e] dark:text-[#c7c7c7]'
      "
    >
      <!-- 版本冲突：由主办方决定保留哪一份 -->
      <template v-if="conflict">
        <p class="mb-1 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiAlertCircle" size="18" />
          同步冲突：需要你确认保留哪一份
        </p>
        <p class="mb-3 leading-relaxed">{{ sync.message }}</p>
        <div class="flex flex-wrap gap-2">
          <BaseButton
            label="采用云端版本"
            color="whiteDark"
            small
            :disabled="busy"
            @click="keepRemote"
          />
          <BaseButton
            label="用本机版本覆盖"
            color="purple"
            small
            :disabled="busy"
            @click="keepLocal"
          />
        </div>
      </template>

      <!-- 读不到云端：明确说明改动只在本机 -->
      <template v-else-if="degraded">
        <p class="mb-1 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiCloudAlert" size="18" />
          本地模式
        </p>
        <p class="mb-3 leading-relaxed">
          {{ isAdmin ? sync.message : '无法连接服务器，当前显示的是本机缓存数据。' }}
        </p>
        <BaseButton
          v-if="isAdmin"
          label="重试连接"
          color="whiteDark"
          small
          :disabled="busy"
          @click="run(() => store.reconnect())"
        />
        <BaseButton v-else label="刷新页面" color="whiteDark" small @click="reloadPage" />
      </template>

      <!-- 写入失败：自动重试 + 手动重试 -->
      <template v-else-if="failed">
        <p class="mb-1 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiCloudAlert" size="18" />
          云端同步失败
        </p>
        <p class="mb-3 leading-relaxed">
          {{ sync.message }}<template v-if="isAdmin">。改动已保存在本机，系统会自动重试。</template>
        </p>
        <BaseButton
          v-if="isAdmin"
          label="立即重试"
          color="whiteDark"
          small
          :disabled="busy"
          @click="run(() => store.retrySync())"
        />
      </template>

      <!-- 数据库未升级：提示补执行 SQL -->
      <template v-else-if="legacyWrite">
        <p class="mb-1 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiAlertCircle" size="18" />
          数据库未升级
        </p>
        <p class="leading-relaxed">
          当前为覆盖式写入，多设备同时编辑可能互相覆盖。请在 Supabase SQL Editor 重新执行
          <code class="font-mono">supabase/schema.sql</code> 以启用版本校验。
        </p>
      </template>

      <p v-else class="flex items-center gap-2">
        <BaseIcon :path="mdiSync" size="16" class="animate-spin" />
        正在同步到云端…
      </p>
    </div>
  </div>
</template>
