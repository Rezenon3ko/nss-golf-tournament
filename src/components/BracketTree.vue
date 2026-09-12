<script setup>
import { computed } from 'vue'
import { useTournamentStore } from '@/stores/tournament'
import PlayerBadge from '@/components/PlayerBadge.vue'
import MatchStatusPill from '@/components/MatchStatusPill.vue'
import { mdiTrophy } from '@mdi/js'
import BaseIcon from '@/components/BaseIcon.vue'

const props = defineProps({
  nodes: {
    type: Array,
    required: true,
  },
})

const emit = defineEmits(['open-match'])

const store = useTournamentStore()

const qf = computed(() => props.nodes.filter((n) => n.stage === 'qf').sort((a, b) => a.order - b.order))
const sf = computed(() => props.nodes.filter((n) => n.stage === 'sf').sort((a, b) => a.order - b.order))
const final = computed(() => props.nodes.find((n) => n.stage === 'final'))

function scoreFor(node, side) {
  if (!node.matchId) return '-'
  const match = store.matches.find((m) => m.id === node.matchId)
  if (!match || match.status !== 'complete') return '-'
  const score = store.matchScore(match)
  return side === 'a' ? score.a : score.b
}

function winnerSide(node) {
  if (!node.matchId) return null
  const match = store.matches.find((m) => m.id === node.matchId)
  if (!match) return null
  return match.winnerId === match.playerAId ? 'a' : match.winnerId === match.playerBId ? 'b' : null
}

function playerOf(node, side) {
  return store.playerById(node[side === 'a' ? 'playerAId' : 'playerBId'])
}
</script>

<template>
  <div class="overflow-x-auto pb-4">
    <div class="mx-auto flex w-fit items-stretch gap-8">
      <div class="flex flex-col">
        <div class="mb-1 text-center text-sm font-bold text-[#a4a097]">八强</div>
        <div class="flex flex-1 flex-col justify-around gap-4">
          <button
            v-for="node in qf"
            :key="`qf-${node.order}`"
            type="button"
            class="notion-card w-80 p-4 text-left transition-shadow hover:shadow-md"
            :class="{ 'cursor-pointer': node.matchId, 'cursor-default': !node.matchId }"
            @click="node.matchId && emit('open-match', node.matchId)"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-bold text-[#a4a097]">{{ node.label }}</span>
              <MatchStatusPill :status="node.status" />
            </div>
            <div
              class="mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-2"
              :class="winnerSide(node) === 'a' ? 'rounded-lg bg-[#e5f6ea] dark:bg-[#183023]' : ''"
            >
              <PlayerBadge v-if="playerOf(node, 'a')" :player="playerOf(node, 'a')" />
              <span v-else class="text-base text-[#a4a097]">{{ node.expectedA }}</span>
              <span class="text-base font-bold">{{ scoreFor(node, 'a') }}</span>
            </div>
            <div
              class="flex items-center justify-between rounded-lg px-2.5 py-2"
              :class="winnerSide(node) === 'b' ? 'rounded-lg bg-[#e5f6ea] dark:bg-[#183023]' : ''"
            >
              <PlayerBadge v-if="playerOf(node, 'b')" :player="playerOf(node, 'b')" />
              <span v-else-if="node.status === 'walkover'" class="text-base font-bold text-[#8c6d1f]">
                直接晋级
              </span>
              <span v-else class="text-base text-[#a4a097]">{{ node.expectedB }}</span>
              <span class="text-base font-bold">{{ scoreFor(node, 'b') }}</span>
            </div>
          </button>
        </div>
      </div>

      <div class="flex flex-col">
        <div class="mb-1 text-center text-sm font-bold text-[#a4a097]">半决赛</div>
        <div class="grid flex-1 grid-rows-2 gap-4">
          <div v-for="node in sf" :key="`sf-${node.order}`" class="flex items-center">
            <button
              type="button"
              class="notion-card w-80 p-4 text-left transition-shadow hover:shadow-md"
              :class="{ 'cursor-pointer': node.matchId, 'cursor-default': !node.matchId }"
              @click="node.matchId && emit('open-match', node.matchId)"
            >
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-bold text-[#a4a097]">{{ node.label }}</span>
                <MatchStatusPill :status="node.status" />
              </div>
              <div
                class="mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-2"
                :class="winnerSide(node) === 'a' ? 'rounded-lg bg-[#e5f6ea] dark:bg-[#183023]' : ''"
              >
                <PlayerBadge v-if="playerOf(node, 'a')" :player="playerOf(node, 'a')" />
                <span v-else class="text-base text-[#a4a097]">{{ node.expectedA }}</span>
                <span class="text-base font-bold">{{ scoreFor(node, 'a') }}</span>
              </div>
              <div
                class="flex items-center justify-between rounded-lg px-2.5 py-2"
                :class="winnerSide(node) === 'b' ? 'rounded-lg bg-[#e5f6ea] dark:bg-[#183023]' : ''"
              >
                <PlayerBadge v-if="playerOf(node, 'b')" :player="playerOf(node, 'b')" />
                <span v-else class="text-base text-[#a4a097]">{{ node.expectedB }}</span>
                <span class="text-base font-bold">{{ scoreFor(node, 'b') }}</span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <div class="flex flex-col">
        <div class="mb-1 text-center text-sm font-bold text-[#a4a097]">决赛</div>
        <div class="flex flex-1 flex-col justify-center">
          <button
            v-if="final"
            type="button"
            class="notion-card w-80 p-4 text-left transition-shadow hover:shadow-md"
            :class="{ 'cursor-pointer': final.matchId, 'cursor-default': !final.matchId }"
            @click="final.matchId && emit('open-match', final.matchId)"
          >
            <div class="mb-2 flex items-center justify-between">
              <span class="text-sm font-bold text-[#a4a097]">{{ final.label }}</span>
              <MatchStatusPill :status="final.status" />
            </div>
            <div
              class="mb-1.5 flex items-center justify-between rounded-lg px-2.5 py-2"
              :class="
                final.status === 'complete'
                  ? winnerSide(final) === 'a'
                    ? 'bg-[#f7e7b0]/70 dark:bg-[#6b5a2a]/30'
                    : 'bg-[#eef2f7] dark:bg-[#2a2a2a]/25'
                  : ''
              "
            >
              <PlayerBadge
                v-if="playerOf(final, 'a')"
                :player="playerOf(final, 'a')"
                :name-class="
                  final.status === 'complete'
                    ? winnerSide(final) === 'a'
                      ? 'text-[#8c6d1f] dark:text-[#e4d3a4]'
                      : 'text-[#64748b] dark:text-[#d0d0d0]'
                    : ''
                "
              />
              <span v-else class="text-base text-[#a4a097]">{{ final.expectedA }}</span>
              <span class="text-base font-bold">{{ scoreFor(final, 'a') }}</span>
            </div>
            <div
              class="flex items-center justify-between rounded-lg px-2.5 py-2"
              :class="
                final.status === 'complete'
                  ? winnerSide(final) === 'b'
                    ? 'bg-[#f7e7b0]/70 dark:bg-[#6b5a2a]/30'
                    : 'bg-[#eef2f7] dark:bg-[#2a2a2a]/25'
                  : ''
              "
            >
              <PlayerBadge
                v-if="playerOf(final, 'b')"
                :player="playerOf(final, 'b')"
                :name-class="
                  final.status === 'complete'
                    ? winnerSide(final) === 'b'
                      ? 'text-[#8c6d1f] dark:text-[#e4d3a4]'
                      : 'text-[#64748b] dark:text-[#d0d0d0]'
                    : ''
                "
              />
              <span v-else-if="final.status === 'walkover'" class="text-base font-bold text-[#8c6d1f]">
                直接夺冠
              </span>
              <span v-else class="text-base text-[#a4a097]">{{ final.expectedB }}</span>
              <span class="text-base font-bold">{{ scoreFor(final, 'b') }}</span>
            </div>
            <div
              v-if="store.championId"
              class="mt-3 flex items-center justify-center gap-1 rounded-lg bg-[#fdf3d8] py-2 text-base font-bold text-[#8c6d1f] dark:bg-[#6b5a2a]/30 dark:text-[#e4d3a4]"
            >
              <BaseIcon :path="mdiTrophy" size="18" />
              {{ store.playerName(store.championId) }} 夺冠
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
