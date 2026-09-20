<script setup>
import { computed, ref } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import { useAuthStore } from '@/stores/auth'
import BracketTree from '@/components/BracketTree.vue'
import MatchDetailModal from '@/components/MatchDetailModal.vue'
import ScoreEntryModal from '@/components/ScoreEntryModal.vue'
import { mdiTrophy } from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'

const store = useTournamentStore()
const auth = useAuthStore()

const detailMatch = ref(null)
const entryMatch = ref(null)

function openMatch(matchId) {
  const match = store.matches.find((m) => m.id === matchId)
  if (!match) return
  if (auth.isAdmin) {
    entryMatch.value = match
  } else {
    detailMatch.value = match
  }
}

const champion = computed(() => store.playerById(store.championId))
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <div class="mb-4">
      <h1 class="text-2xl font-bold">淘汰赛对阵</h1>
      <p class="text-sm text-[#5d5b54] dark:text-[#a0a0a0]">
        五局三胜（BO5）· 小组赛每组前 2 名晋级 · 固定对阵
      </p>
    </div>

    <div
      v-if="store.championId && champion"
      class="notion-banner-yellow mb-5 rounded-2xl p-6 text-center"
    >
      <BaseIcon :path="mdiTrophy" size="40" class="mx-auto mb-2 text-[#b45309]" />
      <p class="mb-1 text-sm text-[#7c5200] dark:text-[#d8c48a]">🏆 冠军</p>
      <p
        class="bg-linear-to-r from-[#f7e7b0] via-[#c9a24b] to-[#8c6d1f] bg-clip-text text-3xl font-black text-transparent"
      >
        {{ champion.name }}
      </p>
      <template v-if="store.runnerUpId">
        <p class="mt-3 text-sm font-semibold text-yellow-700/80 dark:text-[#d8c48a]/80">🥈 亚军</p>
        <p
          class="bg-linear-to-r from-[#94a3b8] via-[#e2e8f0] to-[#64748b] bg-clip-text text-2xl font-bold text-transparent"
        >
          {{ store.playerName(store.runnerUpId) }}
        </p>
      </template>
    </div>

    <div v-if="!store.allGroupsComplete" class="notion-tint-yellow mb-5 rounded-xl p-5 text-sm">
      小组赛尚未全部结束：已完成的小组会先把晋级选手填入八强对应位置，其余位置显示预计对位。
    </div>

    <div class="notion-card p-4">
      <BracketTree :nodes="store.knockoutMatches" @open-match="openMatch" />
    </div>

    <MatchDetailModal v-if="detailMatch" :match="detailMatch" @close="detailMatch = null" />
    <ScoreEntryModal
      v-if="entryMatch"
      :match="entryMatch"
      @close="entryMatch = null"
      @saved="entryMatch = null"
    />
  </div>
</template>
