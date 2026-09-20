import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computed } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const localCache = new Map()
globalThis.localStorage = {
  getItem: (key) => (localCache.has(key) ? localCache.get(key) : null),
  setItem: (key, value) => localCache.set(key, String(value)),
  removeItem: (key) => localCache.delete(key),
  clear: () => localCache.clear(),
  key: (index) => [...localCache.keys()][index] ?? null,
  get length() {
    return localCache.size
  },
}

const { backend } = await import('./fixtures/supabase-stub.js')
const { nowMs, tick } = await import('../src/lib/clock.js')
const { formatCountdown, formatDateTime } = await import('../src/utils/format.js')
const { useTournamentStore } = await import('../src/stores/tournament.js')

const HOUR = 3600000
const DAY = 24 * HOUR

test('formatCountdown 按传入的「当前时间」计算，不需要真实等待', () => {
  const ddl = '2030-01-10T23:59'
  const target = new Date(ddl).getTime()

  assert.equal(formatCountdown(ddl, target - (2 * DAY + 23 * HOUR)), '距截止 2 天 23 小时')
  assert.equal(formatCountdown(ddl, target - (4 * HOUR + 59 * 60000)), '距截止 4 小时 59 分')
  assert.equal(formatCountdown(ddl, target - 29 * 60000), '距截止 29 分钟')
  assert.equal(formatCountdown(ddl, target + 1), '已截止')
  assert.equal(formatCountdown('', target), '')
  assert.equal(formatCountdown('不是时间', target), '')
})

test('formatDateTime 处理空值与非法值', () => {
  assert.equal(formatDateTime(''), '未设置')
  assert.equal(formatDateTime('2026-08-30T23:59'), '2026-08-30 23:59')
  assert.equal(formatDateTime('乱七八糟'), '乱七八糟')
})

test('倒计时依赖全局时钟：时钟推进后自动刷新', () => {
  const ddl = '2030-01-10T23:59'
  const target = new Date(ddl).getTime()

  nowMs.value = target - (1 * HOUR + 59 * 60000)
  const text = computed(() => formatCountdown(ddl))
  assert.equal(text.value, '距截止 1 小时 59 分')

  // 模拟走过截止点（真实环境由 30s 心跳或标签页回到前台触发）
  nowMs.value = target + 1000
  assert.equal(text.value, '已截止')

  tick()
})

test('逾期比赛会随时钟自动出现，无需操作页面', async () => {
  const players = ['p1', 'p2', 'p3', 'p4'].map((id) => ({
    id,
    name: id,
    tier: 1,
    groupId: 'A',
  }))
  const pendingMatch = {
    id: 'gm-A-1-1',
    stage: 'group',
    groupId: 'A',
    round: 1,
    playerAId: 'p1',
    playerBId: 'p2',
    sets: [
      { a: null, b: null, sdWinner: null },
      { a: null, b: null, sdWinner: null },
      { a: null, b: null, sdWinner: null },
    ],
    status: 'pending',
    forfeitBy: null,
    winnerId: null,
    resultLinks: [],
    disconnect: null,
    createdAt: 1,
    updatedAt: 1,
    log: [],
  }
  const ddl = '2030-01-10T23:59'
  backend.reset({
    row: {
      key: 'main',
      value: {
        players,
        matches: [pendingMatch],
        ddlRounds: [{ key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1, ddl }],
      },
      revision: 1,
    },
  })
  localStorage.clear()
  setActivePinia(createPinia())
  const store = useTournamentStore()
  await store.init()

  nowMs.value = new Date(ddl).getTime() - 60000
  assert.equal(store.overdueMatches.length, 0, '未到截止时间不应标记逾期')

  nowMs.value = new Date(ddl).getTime() + 60000
  assert.equal(store.overdueMatches.length, 1, '过截止时间后应自动标记逾期')
  assert.equal(store.overdueMatches[0].match.id, 'gm-A-1-1')

  tick()
})
