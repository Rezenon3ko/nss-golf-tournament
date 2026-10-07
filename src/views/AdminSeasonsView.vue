<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useFeedbackStore } from '@/stores/feedback'
import BaseButton from '@/components/BaseButton.vue'
import BaseIcon from '@/components/BaseIcon.vue'
import {
  mdiArchiveOutline,
  mdiArchiveArrowUpOutline,
  mdiCalendar,
  mdiPencilOutline,
  mdiPlus,
  mdiTrashCanOutline,
} from '@mdi/js'

const store = useTournamentStore()
const feedback = useFeedbackStore()

const enabled = computed(() => store.mirror.model === 'multi')
const seasons = computed(() => store.seasons || [])
const busy = ref('')
const creating = ref(false)
const editing = ref(null)
const form = reactive({ name: '', slug: '', copyFrom: '' })

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// 名称里没有可用字符（例如纯中文）时，用年月生成一个可读的默认标识
function suggestSlug() {
  const fromName = slugify(form.name)
  if (fromName) return fromName
  const now = new Date()
  return `season-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

onMounted(() => {
  if (enabled.value) void store.loadSeasons()
})

async function create() {
  const name = form.name.trim()
  if (!name) {
    feedback.warn('请填写赛季名称')
    return
  }
  const slug = slugify(form.slug) || suggestSlug()

  creating.value = true
  try {
    const result = await store.createSeason({ name, slug, copyFrom: form.copyFrom || null })
    if (!result.ok) {
      feedback.error(result.message)
      return
    }
    feedback.success(`已创建赛季「${name}」`)
    form.name = ''
    form.slug = ''
    form.copyFrom = ''
  } finally {
    creating.value = false
  }
}

function startEdit(season) {
  editing.value = { id: season.id, name: season.name, slug: season.slug }
}

async function saveEdit() {
  const patch = editing.value
  if (!patch) return
  const name = patch.name.trim()
  const slug = slugify(patch.slug)
  if (!name) {
    feedback.warn('赛季名称不能为空')
    return
  }

  busy.value = patch.id
  try {
    // slug 留空表示不改（数据库里保持原标识）
    const result = await store.updateSeason(patch.id, slug ? { name, slug } : { name })
    if (!result.ok) {
      feedback.error(result.message)
      return
    }
    feedback.success('已保存')
    editing.value = null
  } finally {
    busy.value = ''
  }
}

async function makeCurrent(season) {
  busy.value = season.id
  try {
    const result = await store.setCurrentSeason(season.id)
    if (!result.ok) {
      feedback.error(result.message)
      return
    }
    feedback.success(`「${season.name}」已设为当前赛季`)
  } finally {
    busy.value = ''
  }
}

async function toggleArchive(season) {
  const archiving = !season.is_archived
  if (archiving) {
    const ok = await feedback.confirm({
      title: '归档赛季',
      message: `归档后「${season.name}」不再出现在默认列表，可随时取消归档。确认继续？`,
      confirmLabel: '归档',
    })
    if (!ok) return
  }

  busy.value = season.id
  try {
    const result = await store.archiveSeason(season.id, archiving)
    if (!result.ok) {
      feedback.error(result.message)
      return
    }
    feedback.success(archiving ? '已归档' : '已取消归档')
  } finally {
    busy.value = ''
  }
}

// 删除赛季：仅「非当前、非归档」的赛季（建错/弃用的空赛季），级联删除且不可恢复
async function removeSeason(season) {
  const ok = await feedback.confirm({
    title: '删除赛季',
    message: `将永久删除「${season.name}」及其全部名单、赛程、赛果与日志，无法恢复。确认删除？`,
    confirmLabel: '永久删除',
    danger: true,
  })
  if (!ok) return

  busy.value = season.id
  try {
    const result = await store.deleteSeason(season.id)
    if (!result.ok) {
      feedback.error(result.message)
      return
    }
    feedback.success(`已删除赛季「${season.name}」`)
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">赛季管理</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        新建赛季、复制上届名单、切换当前赛季与归档
      </p>
    </div>

    <div v-if="!enabled" class="notion-card p-5 text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
      当前为单文档模式，赛季管理需要部署多表结构并开启
      <code class="font-mono">VITE_DATA_MODEL=multi</code>。
    </div>

    <template v-else>
      <div class="notion-card mb-4 p-5">
        <p class="mb-3 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiPlus" size="18" class="text-[#8c6d1f]" />
          新建赛季
        </p>
        <div
          class="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <label class="text-sm">
            <span class="mb-1 block text-[#5d5b54] dark:text-[#a0a0a0]">名称</span>
            <input
              v-model="form.name"
              type="text"
              placeholder="2026 秋季赛"
              class="w-full rounded-md border border-[#e5e3df] bg-white px-3 py-2 text-[#37352f] focus:outline-hidden dark:border-[#3d3d3d] dark:bg-[#2a2a2a] dark:text-[#e6e6e6]"
            />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-[#5d5b54] dark:text-[#a0a0a0]">标识 slug（可留空）</span>
            <input
              v-model="form.slug"
              type="text"
              placeholder="留空自动生成，如 2026-fall"
              class="w-full rounded-md border border-[#e5e3df] bg-white px-3 py-2 font-mono text-[#37352f] focus:outline-hidden dark:border-[#3d3d3d] dark:bg-[#2a2a2a] dark:text-[#e6e6e6]"
            />
          </label>
          <label class="text-sm">
            <span class="mb-1 block text-[#5d5b54] dark:text-[#a0a0a0]">复制上届（可选）</span>
            <select
              v-model="form.copyFrom"
              class="w-full rounded-md border border-[#e5e3df] bg-white px-3 py-2 text-[#37352f] focus:outline-hidden dark:border-[#3d3d3d] dark:bg-[#2a2a2a] dark:text-[#e6e6e6]"
            >
              <option value="">不复制（空赛季）</option>
              <option v-for="season in seasons" :key="season.id" :value="season.id">
                {{ season.name }}
              </option>
            </select>
          </label>
          <div>
            <BaseButton
              :icon="mdiPlus"
              label="创建赛季"
              color="gold"
              :disabled="creating"
              @click="create"
            />
          </div>
        </div>
        <p class="mt-3 text-xs leading-relaxed text-[#a4a097] dark:text-[#8a8a8a]">
          复制只带名单与 DDL 结构，不含赛果；新建赛季不会自动切为当前赛季；slug
          是数据库里区分赛季的短标识（只允许小写字母、数字与
          <code class="font-mono">-</code
          >），迁移脚本与后台用它定位赛季，不展示给观众；留空会按名称或「season-年-月」自动生成。
        </p>
      </div>

      <div class="notion-card p-5">
        <p class="mb-3 flex items-center gap-2 font-bold">
          <BaseIcon :path="mdiCalendar" size="18" class="text-[#8c6d1f]" />
          全部赛季（{{ seasons.length }}）
        </p>

        <p v-if="!seasons.length" class="text-sm text-[#a4a097] dark:text-[#8a8a8a]">
          还没有赛季。
        </p>

        <div v-else class="flex flex-col divide-y divide-[#ede9e4] dark:divide-[#2e2e2e]">
          <div
            v-for="season in seasons"
            :key="season.id"
            class="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <template v-if="editing && editing.id === season.id">
              <div class="flex flex-1 flex-wrap items-center gap-2">
                <input
                  v-model="editing.name"
                  type="text"
                  class="w-40 rounded-md border border-[#e5e3df] bg-white px-2 py-1.5 text-sm dark:border-[#3d3d3d] dark:bg-[#2a2a2a]"
                />
                <input
                  v-model="editing.slug"
                  type="text"
                  placeholder="留空不改"
                  class="w-36 rounded-md border border-[#e5e3df] bg-white px-2 py-1.5 font-mono text-sm dark:border-[#3d3d3d] dark:bg-[#2a2a2a]"
                />
                <BaseButton
                  label="保存"
                  color="purple"
                  small
                  :disabled="busy === season.id"
                  @click="saveEdit"
                />
                <BaseButton label="取消" color="whiteDark" small @click="editing = null" />
              </div>
            </template>

            <template v-else>
              <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {{ season.name }}
                  <span
                    v-if="season.is_current"
                    class="inline-flex items-center gap-1 rounded-full bg-[#c9a24b]/25 px-2 py-0.5 text-xs font-medium text-[#8c6d1f] dark:text-[#e4d3a4]"
                  >
                    当前
                  </span>
                  <span
                    v-if="season.is_archived"
                    class="inline-flex items-center gap-1 rounded-full bg-[#f0eeec] px-2 py-0.5 text-xs text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]"
                  >
                    <BaseIcon :path="mdiArchiveOutline" size="13" w="w-3.5" h="h-3.5" />
                    已归档
                  </span>
                </p>
                <p class="mt-0.5 font-mono text-xs text-[#a4a097] dark:text-[#8a8a8a]">
                  {{ season.slug }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <BaseButton
                  v-if="!season.is_current"
                  label="设为当前"
                  color="goldSoft"
                  small
                  :disabled="busy === season.id"
                  @click="makeCurrent(season)"
                />
                <BaseButton
                  :icon="mdiPencilOutline"
                  label="重命名"
                  color="whiteDark"
                  small
                  @click="startEdit(season)"
                />
                <BaseButton
                  :icon="season.is_archived ? mdiArchiveArrowUpOutline : mdiArchiveOutline"
                  :label="season.is_archived ? '取消归档' : '归档'"
                  color="whiteDark"
                  small
                  :disabled="busy === season.id"
                  @click="toggleArchive(season)"
                />
                <BaseButton
                  v-if="!season.is_current && !season.is_archived"
                  :icon="mdiTrashCanOutline"
                  label="删除"
                  color="danger"
                  small
                  :disabled="busy === season.id"
                  @click="removeSeason(season)"
                />
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
