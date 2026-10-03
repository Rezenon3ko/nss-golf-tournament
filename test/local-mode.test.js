import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// 必须在加载 store 之前设置：让 config 替身认为「没有配置 Supabase」
process.env.TEST_LOCAL_MODE = '1'

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
const { useTournamentStore } = await import('../src/stores/tournament.js')

const CACHE_KEY = 'test.tournament'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test('未配置 Supabase 时：纯本地模式从空白开始，不报错也不提示同步', async () => {
  backend.reset()
  localStorage.clear()
  setActivePinia(createPinia())
  const store = useTournamentStore()

  await store.init()

  assert.equal(store.ready, true)
  assert.equal(store.sync.mode, 'local')
  assert.equal(store.sync.degraded, false, '未配置云端不应显示「本地模式」告警')
  assert.equal(store.sync.status, 'idle')
  // 全新环境不再内置示例选手，名单由主办方自己维护
  assert.equal(store.players.length, 0, '全新环境名单为空')
  assert.equal(store.matches.length, 0)
  // DDL 轮次结构仍然预置（规则固定），但日期留空待主办方设置
  assert.equal(store.ddlRounds.length, 6)
  assert.ok(
    store.ddlRounds.every((round) => round.ddl === null),
    'DDL 日期不预置',
  )
  assert.deepEqual(
    store.ddlRounds.map((round) => round.key),
    ['group1', 'group2', 'group3', 'qf', 'sf', 'final'],
  )

  store.addPlayer({ name: '本地新增', tier: 1 })
  await sleep(400)

  assert.equal(backend.attempts, 0, '纯本地模式不发起云端请求')
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY))
  assert.ok(cached.players.some((p) => p.name === '本地新增'))
  assert.equal(cached.__pending, false)
})

test('本地模式：有缓存时优先使用缓存而不是空白状态', async () => {
  backend.reset()
  localStorage.clear()
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      players: [{ id: 'p1', name: '缓存选手', tier: 1, groupId: null }],
      matches: [],
    }),
  )
  setActivePinia(createPinia())
  const store = useTournamentStore()

  await store.init()

  assert.equal(store.players.length, 1)
  assert.equal(store.players[0].name, '缓存选手')
})
