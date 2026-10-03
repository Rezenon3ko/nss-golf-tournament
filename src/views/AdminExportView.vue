<script setup>
import { computed, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import BaseButton from '@/components/BaseButton.vue'
import { buildFinalResultText } from '@/lib/finalResult'
import { downloadText } from '@/utils/format'
import { siteName } from '@/config'
import { mdiCodeJson, mdiClipboardText, mdiShareVariant } from '@mdi/js'

const store = useTournamentStore()

const copied = ref('')

const finalResultText = computed(() =>
  buildFinalResultText({
    siteName,
    players: store.players,
    matches: store.matches,
    knockoutMatches: store.knockoutMatches,
    championId: store.championId,
    runnerUpId: store.runnerUpId,
  }),
)

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

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = message
  } catch {
    copied.value = '复制失败'
  }
  setTimeout(() => (copied.value = ''), 3000)
}

function shareFinalResult() {
  return copyText(finalResultText.value, '已复制最终比赛结果')
}

function copyBracket() {
  return copyText(bracketText(), '已复制对阵文本')
}
</script>

<template>
  <div class="p-6 xl:mx-auto xl:max-w-6xl">
    <div class="mb-5">
      <h1 class="text-2xl font-bold">数据导出</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">导出当前赛事数据，用于留档或分享</p>
    </div>

    <div class="notion-card p-5">
      <p class="mb-3 font-bold">数据与分享</p>
      <div class="flex flex-col gap-2">
        <BaseButton
          :icon="mdiShareVariant"
          label="复制最终比赛结果（群聊分享）"
          color="gold"
          @click="shareFinalResult"
        />
        <BaseButton
          :icon="mdiClipboardText"
          label="复制对阵文本（群聊分享）"
          color="purple"
          @click="copyBracket"
        />
        <BaseButton
          :icon="mdiCodeJson"
          label="导出全部数据 JSON"
          color="whiteDark"
          @click="downloadJson"
        />
        <p v-if="copied" class="text-sm text-[#8c6d1f] dark:text-[#e4d3a4]">{{ copied }}</p>
      </div>
    </div>

    <div class="notion-card mt-4 p-5 text-sm">
      <p class="mb-3 font-bold">预览最终比赛结果</p>
      <pre class="notion-card-soft rounded-xl p-4 text-xs whitespace-pre-wrap dark:bg-[#333333]">{{
        finalResultText
      }}</pre>
    </div>

    <div class="notion-card mt-4 p-5 text-sm">
      <p class="mb-3 font-bold">预览对阵文本</p>
      <pre class="notion-card-soft rounded-xl p-4 text-xs whitespace-pre-wrap dark:bg-[#333333]">{{
        bracketText()
      }}</pre>
    </div>
  </div>
</template>
