<script setup>
import { computed, reactive, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { GROUPS } from '@/stores/tournament'
import BaseButton from '@/components/BaseButton.vue'
import BaseModal from '@/components/BaseModal.vue'
import PlayerBadge from '@/components/PlayerBadge.vue'
import {
  mdiAccountPlus,
  mdiDiceMultiple,
  mdiCheckCircle,
  mdiAlertCircle,
  mdiRestore,
  mdiPencil,
  mdiDelete,
} from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'
import { formatDateTime } from '@/utils/format'
import { useFeedbackStore } from '@/stores/feedback'

const store = useTournamentStore()
const feedback = useFeedbackStore()

const showEditor = ref(false)
const editingId = ref(null)
const form = reactive({
  name: '',
  avatar: null,
  bestScore: null,
  tier: 4,
})

// 头像上传：本地裁剪为正方形并压缩，存成 dataURL（随赛事数据一起保存）
function onAvatarChange(event) {
  const input = event.target
  const file = input.files && input.files[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    feedback.warn('请选择图片文件（JPG / PNG）')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const size = 256
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      const side = Math.min(img.width, img.height)
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      )
      form.avatar = canvas.toDataURL('image/jpeg', 0.85)
    }
    img.onerror = () => feedback.error('图片读取失败，请换一张试试')
    img.src = reader.result
  }
  reader.onerror = () => feedback.error('图片读取失败，请换一张试试')
  reader.readAsDataURL(file)
}

function openAdd() {
  editingId.value = null
  form.name = ''
  form.avatar = null
  form.bestScore = null
  form.tier = 4
  showEditor.value = true
}

function openEdit(player) {
  editingId.value = player.id
  form.name = player.name
  form.avatar = player.avatar || null
  form.bestScore = player.bestScore
  form.tier = player.tier
  showEditor.value = true
}

function savePlayer() {
  if (!form.name.trim()) {
    feedback.warn('请填写选手名字')
    return
  }
  if (editingId.value) {
    store.updatePlayer(editingId.value, {
      name: form.name,
      avatar: form.avatar,
      bestScore: form.bestScore,
      tier: Number(form.tier),
    })
  } else {
    store.addPlayer({
      name: form.name,
      avatar: form.avatar,
      bestScore: form.bestScore,
      tier: Number(form.tier),
    })
  }
  showEditor.value = false
  feedback.success(editingId.value ? '选手信息已更新' : '选手已添加')
}

async function removePlayer(player) {
  const ok = await feedback.confirm({
    title: '删除选手',
    message: `确认删除选手「${player.name}」？该选手的所有资料将从名单中移除。`,
    confirmLabel: '删除',
    danger: true,
  })
  if (!ok) return
  const removed = store.removePlayer(player.id)
  if (!removed) feedback.error('该选手已有关联比赛记录，无法删除，可改为停用')
  else feedback.success(`已删除选手「${player.name}」`)
}

async function doDraw() {
  const ok = await feedback.confirm({
    title: '重新抽签',
    message: '将清空当前分组并重新随机分配（加密随机），确定继续？',
    confirmLabel: '重新抽签',
  })
  if (!ok) return
  store.drawGroups()
  feedback.success('已完成随机抽签，请检查分组后发布')
}

async function doPublish() {
  const ok = await feedback.confirm({
    title: '发布分组',
    message: '确认发布分组？发布后将生成全部小组赛赛程（24 场），且无法直接重抽。',
    confirmLabel: '发布分组',
  })
  if (!ok) return
  const published = store.publishGroups()
  if (!published) feedback.error('当前分组不满足约束（每组 4 人、每档各 1 人）')
  else feedback.success('分组已发布，小组赛赛程已生成')
}

async function doReset() {
  const ok = await feedback.confirm({
    title: '重置赛事',
    message: '确认重置赛事？将清空全部赛程、赛果与证据（保留选手名单）。此操作不可撤销。',
    confirmLabel: '重置赛事',
    danger: true,
  })
  if (!ok) return
  store.resetTournament()
  feedback.success('赛事已重置（选手名单已保留）')
}

const tierPlayers = computed(() => {
  const map = {}
  for (const t of [1, 2, 3, 4]) {
    map[t] = store.players.filter((p) => p.tier === t)
  }
  return map
})

function byTierScoreId(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier
  const sa = a.bestScore ?? Infinity
  const sb = b.bestScore ?? Infinity
  if (sa !== sb) return sa - sb
  return String(a.id).localeCompare(String(b.id))
}

const sortedPlayers = computed(() => [...store.players].sort(byTierScoreId))

function playersOfTier(tier) {
  return store.players.filter((p) => p.tier === tier).sort(byTierScoreId)
}

function slotPlayerId(groupId, tierIndex) {
  return store.draft?.[groupId]?.[tierIndex] || ''
}

function isPlayerUsedElsewhere(playerId, groupId) {
  const d = store.draft
  if (!d) return false
  return GROUPS.some((g) => g !== groupId && (d[g] || []).includes(playerId))
}

function onSlotChange(groupId, tierIndex, event) {
  store.setDraftGroup(groupId, tierIndex, event.target.value || null)
}

async function doClearDraft() {
  const ok = await feedback.confirm({
    title: '清空手动分组',
    message: '确认清空手动分组选择？所有下拉将回到「未选择」。',
    confirmLabel: '清空',
    danger: true,
  })
  if (!ok) return
  store.clearDraft()
  feedback.success('手动分组已清空')
}

const valid = computed(() => store.constraintValid())
const published = computed(() => store.players.some((p) => p.groupId))

function tierClass(tier) {
  const map = {
    1: 'rounded-full bg-[#e6e0f5] px-2 py-0.5 text-sm font-semibold text-[#391c57] dark:bg-[#7469a6] dark:text-[#d8cce6]',
    2: 'rounded-full bg-[#dcecfa] px-2 py-0.5 text-sm font-semibold text-[#005bab] dark:bg-[#6b7890] dark:text-[#c2d2e2]',
    3: 'rounded-full bg-[#d9f3e1] px-2 py-0.5 text-sm font-semibold text-[#12902d] dark:bg-[#1d3a2a] dark:text-[#7ec8a0]',
    4: 'rounded-full bg-[#f0eeec] px-2 py-0.5 text-sm font-semibold text-[#5d5b54] dark:bg-[#3d3d3d] dark:text-[#c7c7c7]',
  }
  return map[tier] || ''
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-screen-2xl">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">选手与分组</h1>
        <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
          {{ store.players.length }} 名选手 · 抽签约束：每组 4 人、每档各 1 人
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div class="grid grid-cols-3 gap-2 sm:contents">
          <BaseButton
            :icon="mdiAccountPlus"
            label="添加选手"
            color="purple"
            class="w-full sm:w-auto"
            @click="openAdd"
          />
          <BaseButton
            :icon="mdiDiceMultiple"
            label="随机抽签"
            color="warning"
            class="w-full sm:w-auto"
            :disabled="store.players.length !== 16"
            @click="doDraw"
          />
          <BaseButton
            :icon="mdiRestore"
            label="重置赛事"
            color="danger"
            class="w-full sm:w-auto"
            @click="doReset"
          />
        </div>
        <BaseButton
          v-if="store.draft && !published"
          :icon="mdiCheckCircle"
          label="确认发布分组"
          color="purple"
          class="w-full sm:w-auto"
          :disabled="!valid"
          @click="doPublish"
        />
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div class="notion-card p-5">
        <h2 class="mb-3 font-bold">选手名单</h2>
        <div class="hidden overflow-x-auto lg:block">
          <table class="hover-gold notion-table w-full text-base">
            <thead class="bg-[#f6f5f4] dark:bg-[#1e1e1e]">
              <tr class="border-b border-[#e5e3df] text-left text-sm text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]">
                <th class="py-2 pr-2">选手</th>
                <th class="py-2 pr-2">最佳成绩</th>
                <th class="py-2 pr-2">档位</th>
                <th class="py-2 pr-2">组</th>
                <th class="py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="player in sortedPlayers"
                :key="player.id"
                class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
              >
                <td class="py-2 pr-2"><PlayerBadge :player="player" /></td>
                <td class="py-2 pr-2">{{ player.bestScore ?? '-' }}</td>
                <td class="py-2 pr-2">
                  <span class="rounded-full px-2 py-0.5 text-sm font-semibold" :class="tierClass(player.tier)">
                    {{ player.tier }}档
                  </span>
                </td>
                <td class="py-2 pr-2">{{ player.groupId || '-' }}</td>
                <td class="py-2 text-right">
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center text-[#a4a097] hover:text-[#1aae39]" title="编辑" @click="openEdit(player)">
                    <BaseIcon :path="mdiPencil" size="16" />
                  </button>
                  <button type="button" class="inline-flex h-8 w-8 items-center justify-center text-[#a4a097] hover:text-[#e03131]" title="删除" @click="removePlayer(player)">
                    <BaseIcon :path="mdiDelete" size="16" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="divide-y divide-[#ede9e4] lg:hidden dark:divide-[#2e2e2e]">
          <div
            v-for="player in sortedPlayers"
            :key="player.id"
            class="flex items-center gap-2 py-3"
          >
            <PlayerBadge :player="player" size="sm" truncate class="min-w-0 flex-1" />
            <div class="shrink-0 text-right text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
              <div>
                <span class="rounded-full px-2 py-0.5 text-sm font-semibold" :class="tierClass(player.tier)">
                  {{ player.tier }}档
                </span>
                · {{ player.groupId || '未分组' }}
              </div>
              <div>最佳 {{ player.bestScore ?? '-' }}</div>
            </div>
            <div class="flex shrink-0">
              <button type="button" class="inline-flex h-8 w-8 items-center justify-center text-[#a4a097] hover:text-[#1aae39]" title="编辑" @click="openEdit(player)">
                <BaseIcon :path="mdiPencil" size="16" />
              </button>
              <button type="button" class="inline-flex h-8 w-8 items-center justify-center text-[#a4a097] hover:text-[#e03131]" title="删除" @click="removePlayer(player)">
                <BaseIcon :path="mdiDelete" size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <div class="notion-card p-5">
          <h2 class="mb-3 font-bold">档位池</h2>
          <div class="flex flex-col gap-3">
            <div v-for="t in [1, 2, 3, 4]" :key="t" class="flex items-start gap-3">
              <span
                class="mt-1 w-10 shrink-0 rounded-full px-2 py-0.5 text-center text-sm font-bold"
                :class="tierClass(t)"
              >
                {{ t }}档
              </span>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="p in tierPlayers[t]"
                  :key="p.id"
                  class="rounded-full bg-[#f6f5f4] px-2.5 py-1 text-sm text-[#37352f] dark:bg-[#333333] dark:text-[#c7c7c7]"
                >
                  {{ p.name }}
                </span>
                <span v-if="!tierPlayers[t].length" class="text-sm text-[#a4a097]">空</span>
              </div>
            </div>
          </div>
        </div>

        <div class="notion-card p-5">
          <div class="mb-1 flex items-center justify-between">
            <h2 class="font-bold">手动分组</h2>
            <BaseButton
              label="清空手动选择"
              color="whiteDark"
              small
              @click="doClearDraft"
            />
          </div>
          <p class="mb-3 text-sm text-[#a4a097]">
            默认全部为「未选择」；为每个小组的 1-4 档各选一名选手，同一选手不会重复出现在两组，四组都选满后才能发布。
          </p>
          <div class="grid gap-3 sm:grid-cols-2">
            <div
              v-for="g in GROUPS"
              :key="g"
              class="notion-card-soft p-3"
            >
              <p class="mb-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]">{{ g }}组</p>
              <div v-for="t in [1, 2, 3, 4]" :key="t" class="mb-2 last:mb-0">
                <label class="mb-1 block text-sm text-[#a4a097]">{{ t }}档</label>
                <select
                  :value="slotPlayerId(g, t - 1)"
                  class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 text-sm dark:border-[#454545] dark:bg-[#333333]"
                  @change="onSlotChange(g, t - 1, $event)"
                >
                  <option value="">未选择</option>
                  <option
                    v-for="p in playersOfTier(t)"
                    :key="p.id"
                    :value="p.id"
                    :disabled="isPlayerUsedElsewhere(p.id, g)"
                  >
                    {{ p.name }}
                  </option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="notion-card p-5">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-bold">抽签分组</h2>
            <span
              class="rounded-full px-2.5 py-1 text-sm font-semibold"
              :class="valid ? 'rounded-full bg-[#d9f3e1] px-2.5 py-1 text-sm font-semibold text-[#1aae39] dark:bg-[#1d3a2a] dark:text-[#7ec8a0]' : 'rounded-full bg-[#ffe8d4] px-2.5 py-1 text-sm font-semibold text-[#793400] dark:bg-[#3a2f1a] dark:text-[#d9bf7e]'"
            >
              {{ valid ? '✅ 满足全部约束' : '未满足约束' }}
            </span>
          </div>
          <p v-if="!store.draft" class="mb-3 text-sm text-[#a4a097]">
            尚未分组：点击「随机抽签」，或在上方「手动分组」里为每组选择选手。
          </p>
          <div v-if="store.draft" class="mb-3 grid gap-2 sm:grid-cols-2">
            <div
              v-for="g in GROUPS"
              :key="g"
              class="notion-card-soft p-3 text-sm"
            >
              <p class="mb-1 font-bold text-[#5d5b54] dark:text-[#a0a0a0]">{{ g }}组</p>
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="id in (store.draft[g] || []).filter(Boolean)"
                  :key="id"
                  class="rounded-full bg-[#f6f5f4] px-2 py-0.5 text-sm dark:bg-[#3d3d3d]"
                >
                  {{ store.playerName(id) }}
                </span>
              </div>
            </div>
          </div>
          <div
            v-if="published"
            class="flex items-center gap-2 rounded-lg bg-[#e5f6ea] px-3 py-2 text-sm text-[#1aae39] dark:bg-[#183023] dark:text-[#7ec8a0]"
          >
            <BaseIcon :path="mdiCheckCircle" size="16" />
            分组已发布，赛程已生成。如需重新抽签请先「重置赛事」。
          </div>
          <p v-else class="flex items-center gap-2 rounded-lg bg-[#fef7d6] px-3 py-2 text-sm text-[#793400] dark:bg-[#332a18] dark:text-[#d9bf7e]">
            <BaseIcon :path="mdiAlertCircle" size="16" />
            分组为草稿状态，需「确认发布分组」后生成赛程。
          </p>
        </div>
      </div>
    </div>

    <div
      v-if="store.drawHistory.length"
      class="mt-6 mb-4 notion-card p-5"
    >
      <h2 class="mb-3 font-bold">抽签记录（可验证）</h2>
      <div class="flex flex-col gap-2">
        <div
          v-for="rec in store.drawHistory.slice(0, 5)"
          :key="rec.id"
          class="notion-card-soft p-3 text-sm"
        >
          <p class="mb-2 text-sm text-[#a4a097]">
            {{ formatDateTime(rec.time) }} · {{ rec.by }} · {{ rec.id }}
          </p>
          <div class="flex flex-col gap-1 text-sm">
            <p v-for="t in [1, 2, 3, 4]" :key="t">
              {{ t }}档顺序：
              <span class="text-[#37352f] dark:text-[#c7c7c7]">
                {{ (rec.tiers[t] || []).map((id) => store.playerName(id)).join(' → ') }}
              </span>
            </p>
            <p class="mt-1 text-[#5d5b54] dark:text-[#a0a0a0]">
              分组：
              <span v-for="g in ['A', 'B', 'C', 'D']" :key="g" class="me-2">
                {{ g }}组（{{ (rec.groups[g] || []).map((id) => store.playerName(id)).join('、') }}）
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <BaseModal
      v-if="showEditor"
      :title="editingId ? '编辑选手' : '添加选手'"
      width="max-w-md"
      @close="showEditor = false"
    >
      <div class="flex flex-col gap-4">
        <div>
          <label class="mb-1 block text-sm font-bold">头像</label>
          <div class="flex items-center gap-3">
            <img
              v-if="form.avatar"
              :src="form.avatar"
              alt=""
              class="h-14 w-14 shrink-0 rounded-full object-cover"
            />
            <span
              v-else
              class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#c9a24b]/25 text-lg font-bold text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4]"
            >
              {{ (form.name || '?').slice(0, 1) }}
            </span>
            <div class="flex flex-col items-start gap-1">
              <label
                class="cursor-pointer rounded-lg border border-[#c8c4be] px-3 py-1.5 text-sm font-bold hover:bg-[#f0eeec] dark:border-[#454545] dark:hover:bg-[#3d3d3d]"
              >
                选择图片
                <input type="file" accept="image/*" class="hidden" @change="onAvatarChange" />
              </label>
              <button
                v-if="form.avatar"
                type="button"
                class="text-xs font-semibold text-[#e03131] hover:underline dark:text-[#bd9aa1]"
                @click="form.avatar = null"
              >
                移除头像
              </button>
            </div>
          </div>
          <p class="mt-1 text-xs text-[#a4a097]">支持 JPG / PNG，自动裁剪为正方形并压缩后保存</p>
        </div>
        <div>
          <label class="mb-1 block text-sm font-bold">名字</label>
          <input
            v-model="form.name"
            type="text"
            class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
            placeholder="选手昵称"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-bold">历史最佳（9洞）</label>
            <input
              v-model.number="form.bestScore"
              type="number"
              min="1"
              class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
              placeholder="杆数"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-bold">档位</label>
            <select
              v-model.number="form.tier"
              class="w-full rounded-sm border border-[#c8c4be] px-3 py-2 pr-8 dark:border-[#454545] dark:bg-[#333333]"
            >
              <option :value="1">1档（最强）</option>
              <option :value="2">2档</option>
              <option :value="3">3档</option>
              <option :value="4">4档</option>
            </select>
          </div>
        </div>
      </div>
      <template #footer>
        <BaseButton label="取消" color="whiteDark" @click="showEditor = false" />
        <BaseButton label="保存" color="purple" @click="savePlayer" />
      </template>
    </BaseModal>
  </div>
</template>
