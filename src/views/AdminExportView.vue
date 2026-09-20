<script setup>
import { computed, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import BaseButton from '@/components/BaseButton.vue'
import { downloadText, toCsv } from '@/utils/format'
import { mdiFileDelimited, mdiCodeJson, mdiClipboardText } from '@mdi/js'

const store = useTournamentStore()

const copied = ref('')

const groupCsv = computed(() =>
  store.players.map((p) => ({
    选手: p.name,
    档位: `${p.tier}档`,
    小组: p.groupId || '未分组',
    历史最佳: p.bestScore ?? '',
  })),
)

const standingsCsv = computed(() => {
  const rows = []
  for (const g of ['A', 'B', 'C', 'D']) {
    for (const r of store.getStandings(g)) {
      rows.push({
        小组: g,
        排名: r.rank,
        选手: r.name,
        场次: r.played,
        胜: r.wins,
        负: r.losses,
        积分: r.points,
        净胜局: r.setDiff,
        净胜杆: r.strokeDiff,
        备注: r.needsDraw ? '待抽签' : '',
      })
    }
  }
  return rows
})

const bracketCsv = computed(() =>
  store.knockoutMatches.map((n) => ({
    阶段: store.STAGE_LABELS[n.stage] || n.stage,
    场次: n.label,
    选手A: store.playerName(n.playerAId),
    选手B: store.playerName(n.playerBId),
    状态: store.STATUS_LABELS[n.status] || n.status,
  })),
)

function downloadCsv(name, rows) {
  downloadText(name, toCsv(rows), 'text/csv')
}

function downloadJson() {
  downloadText(
    'ghostfish-tournament.json',
    JSON.stringify(store.exportSnapshot(), null, 2),
    'application/json',
  )
}

function bracketText() {
  const lines = []
  for (const n of store.knockoutMatches) {
    const score =
      n.status === 'complete' && n.matchId
        ? (() => {
            const m = store.matches.find((x) => x.id === n.matchId)
            const s = store.matchScore(m)
            return ` ${s.a}:${s.b}`
          })()
        : ''
    lines.push(
      `${n.label}：${store.playerName(n.playerAId)} vs ${store.playerName(n.playerBId)}${score}`,
    )
  }
  if (store.championId) {
    lines.push('')
    lines.push(`🏆 冠军：${store.playerName(store.championId)}`)
  }
  return lines.join('\n')
}

async function copyBracket() {
  try {
    await navigator.clipboard.writeText(bracketText())
    copied.value = '已复制对阵文本'
  } catch {
    copied.value = '复制失败'
  }
  setTimeout(() => (copied.value = ''), 3000)
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">数据导出</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">导出当前赛事数据，用于留档或分享</p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <div class="notion-card p-5">
        <p class="mb-3 font-bold">CSV 导出</p>
        <div class="flex flex-col gap-2">
          <BaseButton
            :icon="mdiFileDelimited"
            label="导出分组结果 CSV"
            color="whiteDark"
            @click="downloadCsv('分组结果.csv', groupCsv)"
          />
          <BaseButton
            :icon="mdiFileDelimited"
            label="导出积分榜 CSV"
            color="whiteDark"
            @click="downloadCsv('积分榜.csv', standingsCsv)"
          />
          <BaseButton
            :icon="mdiFileDelimited"
            label="导出淘汰赛对阵 CSV"
            color="whiteDark"
            @click="downloadCsv('淘汰赛对阵.csv', bracketCsv)"
          />
        </div>
      </div>

      <div class="notion-card p-5">
        <p class="mb-3 font-bold">完整数据与分享</p>
        <div class="flex flex-col gap-2">
          <BaseButton
            :icon="mdiCodeJson"
            label="导出全部数据 JSON"
            color="whiteDark"
            @click="downloadJson"
          />
          <BaseButton
            :icon="mdiClipboardText"
            label="复制对阵文本（群聊分享）"
            color="purple"
            @click="copyBracket"
          />
          <p v-if="copied" class="text-sm text-[#0075de]">{{ copied }}</p>
        </div>
      </div>
    </div>

    <details class="notion-card mt-4 p-5 text-sm">
      <summary class="cursor-pointer font-bold">预览对阵文本</summary>
      <pre
        class="notion-card-soft mt-3 rounded-xl p-4 text-xs whitespace-pre-wrap dark:bg-[#333333]"
        >{{ bracketText() }}</pre
      >
    </details>
  </div>
</template>
