<script setup>
import { computed } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { buildPbStats, buildSdStats } from '@/lib/stats'
import PlayerBadge from '@/components/PlayerBadge.vue'
import BaseIcon from '@/components/BaseIcon.vue'
import { mdiCardsPlayingOutline, mdiTrendingUp } from '@mdi/js'

const store = useTournamentStore()

const sd = computed(() => buildSdStats({ matches: store.matches, players: store.players }))
const pb = computed(() => buildPbStats({ matches: store.matches, players: store.players }))

const playersWithPb = computed(() => store.players.length - pb.value.missingPb.length)

function stageLabel(entry) {
  if (entry.stage === 'group') return `${entry.groupId}组 第${entry.round}轮`
  const base = store.STAGE_LABELS[entry.stage] || entry.stage
  return entry.order ? `${base}${entry.order}` : base
}

// 相对标准杆：正数补 + 号，便于一眼区分领先/落后
function scoreText(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n > 0 ? `+${n}` : String(n)
}

function winRateText(row) {
  if (!row.played) return '-'
  return `${Math.round((row.wins / row.played) * 100)}%`
}

function entrySummary(entry) {
  return `${stageLabel(entry)} · 第${entry.setIndex + 1}局`
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">数据统计</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        基于已录入的赛果自动统计，录入新赛果后即时更新
      </p>
    </div>

    <!-- SD 之王 -->
    <section class="mb-6">
      <div class="notion-card p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 text-lg font-bold">
            <BaseIcon :path="mdiCardsPlayingOutline" size="20" class="text-[#8c6d1f]" />
            SD 之王
          </h2>
          <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
            共 {{ sd.totalSd }} 局进入 SD
            <span v-if="sd.undecided" class="text-[#dd5b00] dark:text-[#d9bf7e]">
              · {{ sd.undecided }} 局未记录 SD 胜者
            </span>
          </p>
        </div>

        <p
          v-if="!sd.totalSd"
          class="rounded-lg bg-[#f6f5f4] px-4 py-6 text-center text-sm text-[#a4a097] dark:bg-[#2a2a2a]"
        >
          还没有出现「单局 9 洞打平」进入 SD 的比赛
        </p>

        <div v-else class="hidden overflow-x-auto lg:block">
          <table class="hover-gold notion-table w-full text-sm">
            <thead>
              <tr
                class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]"
              >
                <th class="w-16 py-2 pr-3">排名</th>
                <th class="w-56 py-2 pr-3">选手</th>
                <th class="w-24 py-2 pr-3">SD 胜场</th>
                <th class="w-20 py-2 pr-3">胜率</th>
                <th class="w-24 py-2 pr-3">SD 局数</th>
                <th class="py-2">明细</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in sd.rows"
                :key="row.playerId"
                class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
              >
                <td class="py-2 pr-3">
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
                    :class="
                      index === 0
                        ? 'bg-[#f7e7b0] text-[#241a08]'
                        : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]'
                    "
                  >
                    {{ index + 1 }}
                  </span>
                </td>
                <td class="py-2 pr-3">
                  <PlayerBadge
                    :player="store.playerById(row.playerId)"
                    size="sm"
                    truncate
                    class="min-w-0"
                  />
                </td>
                <td class="py-2 pr-3 font-bold">{{ row.wins }}</td>
                <td class="py-2 pr-3">{{ winRateText(row) }}</td>
                <td class="py-2 pr-3">{{ row.played }}</td>
                <td class="py-2">
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="entry in row.details"
                      :key="`${entry.matchId}-${entry.setIndex}`"
                      class="rounded-full bg-[#c9a24b]/15 px-2 py-0.5 text-xs text-[#8c6d1f] dark:bg-[#c9a24b]/20 dark:text-[#e4d3a4]"
                    >
                      {{ entrySummary(entry) }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 移动端：与首页积分榜一致的卡片式展示 -->
        <div v-if="sd.totalSd" class="lg:hidden">
          <div
            v-for="(row, index) in sd.rows"
            :key="row.playerId"
            class="border-b border-[#ede9e4] p-4 last:border-0 dark:border-[#2e2e2e]"
          >
            <div class="flex items-center gap-3">
              <span
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                :class="
                  index === 0
                    ? 'bg-[#f7e7b0] text-[#241a08]'
                    : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]'
                "
              >
                {{ index + 1 }}
              </span>
              <PlayerBadge
                :player="store.playerById(row.playerId)"
                size="sm"
                truncate
                class="min-w-0 flex-1"
              />
              <span class="shrink-0 text-base font-bold">{{ row.wins }} 胜</span>
            </div>
            <div
              class="mt-1 flex items-center justify-between gap-2 pl-10 text-sm font-medium text-[#5d5b54] dark:text-[#c7c7c7]"
            >
              <span>胜率 {{ winRateText(row) }} · SD 局数 {{ row.played }}</span>
            </div>
            <div v-if="row.details.length" class="mt-2 flex flex-wrap gap-1 pl-10">
              <span
                v-for="entry in row.details"
                :key="`m-${entry.matchId}-${entry.setIndex}`"
                class="rounded-full bg-[#c9a24b]/15 px-2 py-0.5 text-xs text-[#8c6d1f] dark:bg-[#c9a24b]/20 dark:text-[#e4d3a4]"
              >
                {{ entrySummary(entry) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- PB 之星 -->
    <section class="mb-6">
      <div class="notion-card p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 class="flex items-center gap-2 text-lg font-bold">
            <BaseIcon :path="mdiTrendingUp" size="20" class="text-[#8c6d1f]" />
            PB 之星
          </h2>
          <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
            {{ pb.rows.length }} 人共突破 {{ pb.totalBreaks }} 次 · 已填报名 PB
            {{ playersWithPb }}/{{ store.players.length }} 人
          </p>
        </div>

        <p
          v-if="!pb.rows.length"
          class="rounded-lg bg-[#f6f5f4] px-4 py-6 text-center text-sm text-[#a4a097] dark:bg-[#2a2a2a]"
        >
          还没有人单局成绩优于报名时填的历史最佳
        </p>

        <div v-else class="hidden overflow-x-auto lg:block">
          <table class="hover-gold notion-table w-full text-sm">
            <thead>
              <tr
                class="border-b border-[#e5e3df] text-left text-xs text-[#5d5b54] dark:border-[#3d3d3d] dark:text-[#a0a0a0]"
              >
                <th class="w-16 py-2 pr-3">排名</th>
                <th class="w-56 py-2 pr-3">选手</th>
                <th class="w-24 py-2 pr-3">报名 PB</th>
                <th class="w-24 py-2 pr-3">突破次数</th>
                <th class="w-28 py-2 pr-3">最好成绩</th>
                <th class="py-2">明细</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, index) in pb.rows"
                :key="row.playerId"
                class="border-b border-[#ede9e4] last:border-0 dark:border-[#2e2e2e]"
              >
                <td class="py-2 pr-3">
                  <span
                    class="inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
                    :class="
                      index === 0
                        ? 'bg-[#f7e7b0] text-[#241a08]'
                        : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]'
                    "
                  >
                    {{ index + 1 }}
                  </span>
                </td>
                <td class="py-2 pr-3">
                  <PlayerBadge
                    :player="store.playerById(row.playerId)"
                    size="sm"
                    truncate
                    class="min-w-0"
                  />
                </td>
                <td class="py-2 pr-3 text-[#5d5b54] dark:text-[#a0a0a0]">
                  {{ scoreText(row.pb) }}
                </td>
                <td class="py-2 pr-3 font-bold">{{ row.count }}</td>
                <td class="py-2 pr-3">
                  <span class="font-semibold text-[#1aae39] dark:text-[#7ec8a0]">
                    {{ scoreText(row.bestScore) }}
                  </span>
                  <span class="ms-1 text-xs text-[#a4a097]">↑{{ row.bestDelta }}</span>
                </td>
                <td class="py-2">
                  <div class="flex flex-wrap gap-1">
                    <span
                      v-for="entry in row.breaks"
                      :key="`${entry.matchId}-${entry.setIndex}`"
                      class="rounded-full bg-[#e5f6ea] px-2 py-0.5 text-xs text-[#146c2e] dark:bg-[#142a1e] dark:text-[#7ec8a0]"
                    >
                      {{ entrySummary(entry) }} · {{ scoreText(entry.score) }}（↑{{ entry.delta }}）
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- 移动端：与首页积分榜一致的卡片式展示 -->
        <div v-if="pb.rows.length" class="lg:hidden">
          <div
            v-for="(row, index) in pb.rows"
            :key="row.playerId"
            class="border-b border-[#ede9e4] p-4 last:border-0 dark:border-[#2e2e2e]"
          >
            <div class="flex items-center gap-3">
              <span
                class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold"
                :class="
                  index === 0
                    ? 'bg-[#f7e7b0] text-[#241a08]'
                    : 'bg-[#f6f5f4] text-[#5d5b54] dark:bg-[#333333] dark:text-[#a0a0a0]'
                "
              >
                {{ index + 1 }}
              </span>
              <PlayerBadge
                :player="store.playerById(row.playerId)"
                size="sm"
                truncate
                class="min-w-0 flex-1"
              />
              <span class="shrink-0 text-base font-bold">{{ row.count }} 次</span>
            </div>
            <div
              class="mt-1 flex items-center justify-between gap-2 pl-10 text-sm font-medium text-[#5d5b54] dark:text-[#c7c7c7]"
            >
              <span>
                报名 PB {{ scoreText(row.pb) }} · 最好
                <span class="font-semibold text-[#1aae39] dark:text-[#7ec8a0]">
                  {{ scoreText(row.bestScore) }} ↑{{ row.bestDelta }}
                </span>
              </span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1 pl-10">
              <span
                v-for="entry in row.breaks"
                :key="`m-${entry.matchId}-${entry.setIndex}`"
                class="rounded-full bg-[#e5f6ea] px-2 py-0.5 text-xs text-[#146c2e] dark:bg-[#142a1e] dark:text-[#7ec8a0]"
              >
                {{ entrySummary(entry) }} · {{ scoreText(entry.score) }}（↑{{ entry.delta }}）
              </span>
            </div>
          </div>
        </div>

        <p
          v-if="pb.missingPb.length"
          class="mt-3 rounded-lg bg-[#fef7d6] px-3 py-2 text-xs text-[#793400] dark:bg-[#2b2415] dark:text-[#d9bf7e]"
        >
          未填写报名 PB 的选手（不参与统计）：
          {{ pb.missingPb.map((p) => p.name).join('、') }}
          —— 可在「选手与分组」里补填历史最佳成绩
        </p>
      </div>
    </section>

    <p class="text-xs leading-relaxed text-[#a4a097]">
      统计口径：SD 以每局记录里的「平局 SD 胜者」为准，榜单按 胜场数 → 胜率 → 局数 排序； PB
      突破指某局成绩严格优于报名时填写的 历史最佳成绩（两者同为「相对标准杆」，如 -16）， ↑
      后的数字为与 PB 的差值（负数表示进步），平 PB 不计入；判负、轮空与未录入成绩的局不参与统计。
    </p>
  </div>
</template>
