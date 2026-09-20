<script setup>
import { computed, reactive, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import BaseButton from '@/components/BaseButton.vue'
import BaseModal from '@/components/BaseModal.vue'
import { formatDateTime } from '@/utils/format'
import { mdiPlus } from '@mdi/js'
import { useFeedbackStore } from '@/stores/feedback'

const store = useTournamentStore()
const feedback = useFeedbackStore()

const typeFilter = ref('all')
const showAdd = ref(false)
const form = reactive({
  matchId: '',
  type: 'result',
  name: '',
  url: '',
})

const typeLabels = {
  result: '赛果截图',
  disconnect: '掉线证据',
  other: '其他',
}

const filtered = computed(() =>
  store.evidence.filter((e) => typeFilter.value === 'all' || e.type === typeFilter.value),
)

function matchLabel(matchId) {
  const match = store.matches.find((m) => m.id === matchId)
  if (!match) return '（未关联）'
  const prefix = match.stage === 'group' ? `${match.groupId}组 ` : ''
  return `${prefix}${store.playerName(match.playerAId)} vs ${store.playerName(match.playerBId)}`
}

function save() {
  if (!form.url.trim()) {
    feedback.warn('请填写证据链接')
    return
  }
  store.addEvidence({
    matchId: form.matchId || null,
    type: form.type,
    name: form.name,
    url: form.url,
  })
  showAdd.value = false
  form.matchId = ''
  form.type = 'result'
  form.name = ''
  form.url = ''
  feedback.success('证据已记录')
}

async function remove(id) {
  const ok = await feedback.confirm({
    title: '删除证据',
    message: '确认删除该证据？删除后无法恢复。',
    confirmLabel: '删除',
    danger: true,
  })
  if (!ok) return
  store.removeEvidence(id)
  feedback.success('证据已删除')
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">证据与日志</h1>
        <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
          赛果截图 / 掉线证据统一留档 · 操作日志可追溯
        </p>
      </div>
      <BaseButton :icon="mdiPlus" label="添加证据" color="purple" @click="showAdd = true" />
    </div>

    <div class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="(label, value) in { all: '全部', ...typeLabels }"
        :key="value"
        type="button"
        class="rounded-full px-3 py-1.5 text-sm"
        :class="
          typeFilter === value
            ? 'notion-pill-active font-semibold'
            : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#1e1e1e] dark:text-[#c7c7c7]'
        "
        @click="typeFilter = value"
      >
        {{ label }}
      </button>
    </div>

    <div class="notion-card mb-6 overflow-x-auto">
      <table class="notion-table w-full text-sm">
        <thead>
          <tr
            class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]"
          >
            <th class="px-4 py-3">名称</th>
            <th class="px-4 py-3">关联比赛</th>
            <th class="px-4 py-3">类型</th>
            <th class="px-4 py-3">链接</th>
            <th class="px-4 py-3">上传人</th>
            <th class="px-4 py-3">时间</th>
            <th class="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="ev in filtered"
            :key="ev.id"
            class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
          >
            <td class="px-4 py-3 font-medium">{{ ev.name }}</td>
            <td class="px-4 py-3">{{ matchLabel(ev.matchId) }}</td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="
                  ev.type === 'result'
                    ? 'bg-[#d9f3e1] text-[#1aae39] dark:bg-[#1d3a2a] dark:text-[#7ec8a0]'
                    : ev.type === 'disconnect'
                      ? 'bg-[#ffe8d4] text-[#793400] dark:bg-[#3a2f1a] dark:text-[#d9bf7e]'
                      : 'notion-card-soft text-[#37352f] dark:bg-[#333333] dark:text-[#c7c7c7]'
                "
              >
                {{ typeLabels[ev.type] || '其他' }}
              </span>
            </td>
            <td class="px-4 py-3">
              <a
                :href="ev.url"
                target="_blank"
                rel="noopener"
                class="max-w-[200px] truncate text-[#0075de] underline"
              >
                {{ ev.url }}
              </a>
            </td>
            <td class="px-4 py-3">{{ ev.by }}</td>
            <td class="px-4 py-3 text-xs text-[#5d5b54] dark:text-[#a0a0a0]">
              {{ formatDateTime(ev.time) }}
            </td>
            <td class="px-4 py-3 text-right">
              <BaseButton label="删除" color="danger" small @click="remove(ev.id)" />
            </td>
          </tr>
          <tr v-if="!filtered.length">
            <td colspan="7" class="px-4 py-8 text-center text-[#a4a097]">暂无证据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="notion-card p-5">
      <h2 class="mb-3 font-bold">操作日志（最近 30 条）</h2>
      <ul
        class="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm text-[#37352f] dark:text-[#c7c7c7]"
      >
        <li v-for="log in store.logs.slice(0, 30)" :key="log.id" class="flex gap-2">
          <span class="shrink-0 text-xs text-[#a4a097]">{{ formatDateTime(log.time) }}</span>
          <span class="shrink-0 font-semibold">{{ log.by }}</span>
          <span>{{ log.message }}</span>
        </li>
        <li v-if="!store.logs.length" class="text-[#a4a097]">暂无日志</li>
      </ul>
    </div>

    <BaseModal v-if="showAdd" title="添加证据" width="max-w-md" @close="showAdd = false">
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1 block text-sm font-bold">关联比赛</label>
          <select
            v-model="form.matchId"
            class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
          >
            <option value="">不关联</option>
            <option v-for="m in store.matches" :key="m.id" :value="m.id">
              {{ matchLabel(m.id) }}
            </option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-bold">类型</label>
            <select
              v-model="form.type"
              class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
            >
              <option value="result">赛果截图</option>
              <option value="disconnect">掉线证据</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-sm font-bold">名称</label>
            <input
              v-model="form.name"
              type="text"
              class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
              placeholder="选填"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-sm font-bold">链接</label>
          <input
            v-model="form.url"
            type="url"
            class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
            placeholder="https://...（图片 / 录屏链接）"
          />
        </div>
      </div>
      <template #footer>
        <BaseButton label="取消" color="whiteDark" @click="showAdd = false" />
        <BaseButton label="保存" color="purple" @click="save" />
      </template>
    </BaseModal>
  </div>
</template>
