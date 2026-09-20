<script setup>
import { computed } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import BaseModal from '@/components/BaseModal.vue'
import PlayerBadge from '@/components/PlayerBadge.vue'
import MatchStatusPill from '@/components/MatchStatusPill.vue'
import BaseButton from '@/components/BaseButton.vue'
import { formatDateTime } from '@/utils/format'
import { countedSetCount } from '@/lib/scoring'

const props = defineProps({
  match: {
    type: Object,
    required: true,
  },
})

const emit = defineEmits(['close'])

const store = useTournamentStore()

const playerA = computed(() => store.playerById(props.match.playerAId))
const playerB = computed(() => store.playerById(props.match.playerBId))
const matchScore = computed(() => store.matchScore(props.match))
// 决胜局之后误填的局：原样展示，但标注不计入
const ignoredFrom = computed(() => {
  const sets = props.match.sets || []
  const counted = countedSetCount(sets, props.match)
  return counted < sets.length ? counted : -1
})
const stageLabel = computed(() => {
  if (props.match.stage === 'group') {
    return `${props.match.groupId}组 · 第${props.match.round}轮`
  }
  return store.STAGE_LABELS[props.match.stage] || ''
})

const relatedEvidence = computed(() => store.evidence.filter((e) => e.matchId === props.match.id))

function setLabel(set) {
  const a = set.a
  const b = set.b
  if (a == null && b == null) return '未赛'
  if (a == null || b == null) return '未赛'
  if (a < b) return `${store.playerName(props.match.playerAId)}胜`
  if (b < a) return `${store.playerName(props.match.playerBId)}胜`
  return set.sdWinner ? `平局 · SD → ${store.playerName(set.sdWinner)}` : '平局'
}
</script>

<template>
  <BaseModal
    :title="`${store.playerName(match.playerAId)} vs ${store.playerName(match.playerBId)}`"
    @close="emit('close')"
  >
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <MatchStatusPill :status="match.status" />
      <span class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">{{ stageLabel }}</span>
      <span v-if="match.status === 'forfeit'" class="text-sm text-[#dd5b00] dark:text-[#d9bf7e]">
        {{
          match.forfeitBy === 'A'
            ? `${store.playerName(match.playerAId)}判负`
            : match.forfeitBy === 'B'
              ? `${store.playerName(match.playerBId)}判负`
              : '双方判负'
        }}
      </span>
    </div>

    <div class="notion-card-soft mb-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-4">
      <PlayerBadge :player="playerA" />
      <span class="text-xl font-bold">
        {{ match.status === 'complete' ? `${matchScore.a} : ${matchScore.b}` : '-' }}
      </span>
      <div class="justify-self-end">
        <PlayerBadge :player="playerB" />
      </div>
    </div>

    <h4 class="mb-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]">
      各局成绩（相对标准杆）
    </h4>
    <div class="mb-4 overflow-x-auto">
      <table class="notion-table w-full text-sm">
        <thead>
          <tr
            class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]"
          >
            <th class="py-2 pr-2">局</th>
            <th class="py-2 pr-2">{{ playerA?.name || '甲' }} 相对标准杆</th>
            <th class="py-2 pr-2">{{ playerB?.name || '乙' }} 相对标准杆</th>
            <th class="py-2">结果</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(set, index) in match.sets"
            :key="index"
            class="border-b border-[#ede9e4] dark:border-[#2e2e2e]"
            :class="ignoredFrom >= 0 && index >= ignoredFrom ? 'opacity-55' : ''"
          >
            <td data-label="局" class="py-2 pr-2 font-semibold">
              {{ index + 1 }}
              <span
                v-if="ignoredFrom >= 0 && index >= ignoredFrom"
                class="ms-1 rounded bg-[#f6f5f4] px-1.5 py-0.5 text-[10px] font-normal text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]"
                title="比赛已在此前分出胜负，本局不计入胜负与净胜杆"
              >
                不计入
              </span>
            </td>
            <td :data-label="`${playerA?.name || '甲'} 相对标准杆`" class="py-2 pr-2">
              {{ set.a ?? '-' }}
            </td>
            <td :data-label="`${playerB?.name || '乙'} 相对标准杆`" class="py-2 pr-2">
              {{ set.b ?? '-' }}
            </td>
            <td data-label="结果" class="py-2">{{ setLabel(set) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="match.disconnect"
      class="notion-tint-yellow mb-4 rounded-xl p-4 text-sm dark:bg-[#2b2415]"
    >
      <p class="mb-1 font-bold text-[#793400] dark:text-[#d9bf7e]">掉线登记</p>
      <p>
        掉线发生局：第 {{ match.disconnect.setIndex + 1 }} 局 · 已完成洞数：{{
          match.disconnect.holesCompleted
        }}
      </p>
      <p v-if="match.disconnect.note">{{ match.disconnect.note }}</p>
      <p v-if="match.disconnect.links?.length" class="mt-1">
        证据：
        <a
          v-for="(link, i) in match.disconnect.links"
          :key="i"
          :href="link"
          target="_blank"
          rel="noopener"
          class="text-[#0075de] underline"
        >
          {{ link }}
        </a>
      </p>
    </div>

    <h4 class="mb-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]">结果截图</h4>
    <div v-if="match.resultLinks?.length" class="mb-4 flex flex-col gap-1">
      <a
        v-for="(link, i) in match.resultLinks"
        :key="i"
        :href="link"
        target="_blank"
        rel="noopener"
        class="text-sm text-[#0075de] underline"
      >
        {{ link }}
      </a>
    </div>
    <p v-else class="mb-4 text-sm text-[#a4a097]">暂无截图</p>

    <template v-if="relatedEvidence.length">
      <h4 class="mb-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]">赛事证据库</h4>
      <div class="mb-4 flex flex-col gap-1">
        <a
          v-for="ev in relatedEvidence"
          :key="ev.id"
          :href="ev.url"
          target="_blank"
          rel="noopener"
          class="text-sm text-[#0075de] underline"
        >
          {{ ev.name }}（{{
            ev.type === 'result' ? '赛果截图' : ev.type === 'disconnect' ? '掉线证据' : '其他'
          }}）
        </a>
      </div>
    </template>

    <template v-if="match.log?.length">
      <h4 class="mb-2 text-sm font-bold text-[#5d5b54] dark:text-[#a0a0a0]">操作记录</h4>
      <ul class="mb-2 flex flex-col gap-1 text-xs text-[#5d5b54] dark:text-[#a0a0a0]">
        <li v-for="(entry, i) in [...match.log].reverse()" :key="i">
          {{ formatDateTime(entry.time) }} · {{ entry.by }}：{{ entry.message }}
        </li>
      </ul>
    </template>

    <template #footer>
      <BaseButton label="关闭" color="whiteDark" @click="emit('close')" />
    </template>
  </BaseModal>
</template>
