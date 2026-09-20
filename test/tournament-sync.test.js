import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// localStorage 替身：必须在加载 store 之前装好
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

async function waitFor(predicate, { timeout = 2000, interval = 10 } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(interval)
  }
  return predicate()
}

function cachedSnapshot() {
  const raw = localStorage.getItem(CACHE_KEY)
  return raw ? JSON.parse(raw) : null
}

function names(snapshot) {
  return (snapshot?.players || []).map((p) => p.name)
}

function cloudState() {
  return backend.row ? backend.row.value : null
}

async function freshStore({
  value = { players: [{ id: 'p1', name: '云端选手', tier: 1, groupId: null }], matches: [] },
  revision = 3,
  row = 'auto',
  readError = null,
  writeError = null,
  missingRevisionColumn = false,
  writeEnabled = true,
  cache = null,
  rlsBlocksUpdate = false,
  rlsBlocksInsert = false,
  emptyRowResponse = 'pgrst116',
} = {}) {
  const resolvedRow =
    row === 'auto' ? (value === null ? null : { key: 'main', value, revision }) : row
  backend.reset({
    row: resolvedRow,
    readError,
    writeError,
    missingRevisionColumn,
    rlsBlocksUpdate,
    rlsBlocksInsert,
    emptyRowResponse,
  })
  localStorage.clear()
  if (cache) localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  setActivePinia(createPinia())
  const store = useTournamentStore()
  await store.init()
  store.setCloudWriteEnabled(writeEnabled)
  return store
}

test('打开时从云端读取并记录版本号', async () => {
  const store = await freshStore({ revision: 3 })

  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.status, 'idle')
  assert.equal(store.sync.revision, 3)
  assert.equal(store.sync.pendingChanges, false)
  assert.deepEqual(names(store.exportSnapshot()), ['云端选手'])
  // 本地也留一份缓存，断网时仍能看到最近数据
  assert.deepEqual(names(cachedSnapshot()), ['云端选手'])
})

test('修改后带版本号写入云端，连续改动合并为一次写入', async () => {
  const store = await freshStore({ revision: 3 })

  store.addPlayer({ name: '选手一', tier: 1 })
  store.addPlayer({ name: '选手二', tier: 2 })

  assert.ok(await waitFor(() => store.sync.status === 'idle' && !store.sync.pendingChanges))
  assert.equal(backend.attempts, 1, '防抖后应只发一次写入')
  assert.equal(backend.row.revision, 4, '一次写入只推进一个版本')
  assert.deepEqual(names(cloudState()), ['云端选手', '选手一', '选手二'])
  assert.equal(store.sync.lastSyncedAt > 0, true)
})

test('云端还没有数据时，主办方登录后写入首份数据', async () => {
  // 先不开启写入，检查「空表」的判定结果
  const store = await freshStore({ row: null, writeEnabled: false })

  // 空表时 PostgREST 返回 406 + PGRST116：必须当作「还没有数据」，而不是「读不到云端」
  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.degraded, false)
  assert.equal(store.sync.status, 'idle')
  assert.equal(store.sync.revision, 0)
  assert.equal(store.sync.pendingChanges, true)

  store.setCloudWriteEnabled(true)
  assert.ok(await waitFor(() => backend.row !== null))
  assert.equal(backend.row.revision, 1)
})

test('空表也可能是 200 + null：同样按「还没有数据」处理', async () => {
  const store = await freshStore({ row: null, emptyRowResponse: 'null', writeEnabled: false })

  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.degraded, false)
  assert.equal(store.sync.pendingChanges, true)

  store.setCloudWriteEnabled(true)
  assert.ok(await waitFor(() => backend.row !== null))
  assert.equal(backend.row.revision, 1)
})

test('云端被其他设备推进时进入冲突态，不自动覆盖', async () => {
  const store = await freshStore({ revision: 3 })
  backend.bumpRemoteRevision() // 另一台设备刚写过

  store.addPlayer({ name: '本机改动', tier: 1 })

  assert.ok(await waitFor(() => store.sync.status === 'conflict'))
  assert.equal(backend.row.revision, 4, '云端不被本机覆盖')
  assert.equal(backend.writes.length, 0)
  assert.equal(store.sync.conflictRemote.revision, 4)
})

test('数据库触发器推进版本号时，客户端读回服务端版本并连续写入', async () => {
  const store = await freshStore({ revision: 9 })
  backend.serverTrigger = true

  store.addPlayer({ name: '甲', tier: 1 })
  assert.ok(await waitFor(() => !store.sync.pendingChanges))
  assert.equal(backend.row.revision, 10)
  assert.equal(store.sync.revision, 10, '以服务端返回的版本号为准')

  store.addPlayer({ name: '乙', tier: 2 })
  assert.ok(await waitFor(() => !store.sync.pendingChanges))
  assert.equal(backend.row.revision, 11)
  assert.equal(store.sync.revision, 11)
  assert.deepEqual(names(cloudState()), ['云端选手', '甲', '乙'])
})

test('RLS 未放行导致更新命中 0 行时，报“没有写入权限”而不是版本冲突', async () => {
  const store = await freshStore({ revision: 3, rlsBlocksUpdate: true })

  store.addPlayer({ name: '无权写入', tier: 1 })

  assert.ok(await waitFor(() => store.sync.status === 'error'))
  assert.equal(store.sync.status, 'error', '不应进入冲突态')
  assert.equal(store.sync.conflictRemote, null)
  assert.match(store.sync.message, /没有写入权限/)
  assert.equal(backend.row.revision, 3, '云端未被改动')
  assert.equal(store.sync.pendingChanges, true, '改动仍保留在本机等待重试')
})

test('云端确实被其他设备推进时仍判定为冲突（与权限问题区分开）', async () => {
  const store = await freshStore({ revision: 3 })
  backend.bumpRemoteRevision()

  store.addPlayer({ name: '本机改动', tier: 1 })

  assert.ok(await waitFor(() => store.sync.status === 'conflict'))
  assert.equal(store.sync.conflictRemote.revision, 4)
  assert.doesNotMatch(store.sync.message, /没有写入权限/)
})

test('冲突时选择「采用云端版本」会丢弃本机未同步改动', async () => {
  const store = await freshStore({ revision: 3 })
  backend.bumpRemoteRevision()
  store.addPlayer({ name: '本机改动', tier: 1 })
  await waitFor(() => store.sync.status === 'conflict')

  store.useRemoteVersion()

  assert.equal(store.sync.status, 'idle')
  assert.equal(store.sync.revision, 4)
  assert.equal(store.sync.pendingChanges, false)
  assert.deepEqual(names(store.exportSnapshot()), ['云端选手'])
})

test('冲突时选择「用本机版本覆盖」会以云端最新版本为基线重写', async () => {
  const store = await freshStore({ revision: 3 })
  backend.bumpRemoteRevision()
  store.addPlayer({ name: '本机改动', tier: 1 })
  await waitFor(() => store.sync.status === 'conflict')

  assert.equal(await store.useLocalVersion(), true)

  assert.equal(store.sync.status, 'idle')
  assert.equal(backend.row.revision, 5)
  assert.deepEqual(names(cloudState()), ['云端选手', '本机改动'])
})

test('写入失败时标记未同步、保留本地缓存，重试后补齐', async () => {
  const store = await freshStore({ revision: 2, writeError: new TypeError('Failed to fetch') })

  store.addPlayer({ name: '断网录入', tier: 2 })

  assert.ok(await waitFor(() => store.sync.status === 'error'))
  assert.equal(store.sync.pendingChanges, true)
  assert.match(store.sync.message, /网络异常/)
  assert.deepEqual(names(cachedSnapshot()), ['云端选手', '断网录入'])
  assert.equal(backend.row.revision, 2, '云端仍是旧版本')

  backend.writeError = null
  assert.equal(await store.retrySync(), true)

  assert.equal(store.sync.status, 'idle')
  assert.equal(store.sync.pendingChanges, false)
  assert.equal(backend.row.revision, 3)
  assert.deepEqual(names(cloudState()), ['云端选手', '断网录入'])
})

test('读不到云端时进入本地模式：改动只落本机，不写云端', async () => {
  const store = await freshStore({
    readError: new TypeError('Failed to fetch'),
    // 之前打开过站点留下的本机缓存
    cache: { players: [{ id: 'p9', name: '本机缓存选手', tier: 1, groupId: null }], matches: [] },
  })

  assert.equal(store.sync.mode, 'local')
  assert.equal(store.sync.degraded, true)
  assert.equal(store.sync.status, 'local-only')
  assert.match(store.sync.message, /只保存在本机/)

  store.addPlayer({ name: '本地录入', tier: 3 })
  await sleep(400)

  assert.equal(backend.attempts, 0, '降级模式不写云端')
  assert.equal(store.sync.pendingChanges, true)
  assert.deepEqual(names(cachedSnapshot()), ['本机缓存选手', '本地录入'])
})

test('恢复连接后，本机有未同步改动时交给主办方选择', async () => {
  const store = await freshStore({
    revision: 7,
    readError: new TypeError('Failed to fetch'),
    cache: { players: [{ id: 'p9', name: '本机缓存选手', tier: 1, groupId: null }], matches: [] },
  })
  store.addPlayer({ name: '本地录入', tier: 3 })
  await sleep(400)

  backend.readError = null
  assert.equal(await store.reconnect(), true)

  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.degraded, false)
  assert.equal(store.sync.status, 'conflict')
  assert.equal(store.sync.conflictRemote.revision, 7)

  assert.equal(await store.useLocalVersion(), true)
  assert.equal(backend.row.revision, 8)
  assert.deepEqual(names(cloudState()), ['本机缓存选手', '本地录入'])
})

test('恢复连接且本机无改动时直接采用云端数据', async () => {
  const store = await freshStore({ revision: 7, readError: new TypeError('Failed to fetch') })

  backend.readError = null
  assert.equal(await store.reconnect(), true)

  assert.equal(store.sync.status, 'idle')
  assert.equal(store.sync.revision, 7)
  assert.deepEqual(names(store.exportSnapshot()), ['云端选手'])
})

test('本机缓存里有上次未同步成功的改动时，打开即提示选择，不静默丢弃', async () => {
  const store = await freshStore({
    revision: 5,
    // 上次断网录入后直接关页：改动停在本地缓存
    cache: {
      players: [{ id: 'p9', name: '上次断网录入', tier: 1, groupId: null }],
      matches: [],
      __pending: true,
    },
  })

  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.status, 'conflict')
  assert.equal(store.sync.pendingChanges, true)
  assert.equal(store.sync.conflictRemote.revision, 5)
  // 本机改动仍在内存里，等主办方决定
  assert.deepEqual(names(store.exportSnapshot()), ['上次断网录入'])
  assert.equal(backend.attempts, 0)

  assert.equal(await store.useLocalVersion(), true)
  assert.equal(backend.row.revision, 6)
  assert.deepEqual(names(cloudState()), ['上次断网录入'])
  assert.equal(cachedSnapshot().__pending, false)
})

test('老库缺少 revision 列时自动降级为覆盖式写入', async () => {
  const store = await freshStore({ revision: 0, missingRevisionColumn: true })

  assert.equal(store.sync.mode, 'cloud')
  assert.equal(store.sync.supportsRevision, false)

  store.addPlayer({ name: '老库写入', tier: 1 })

  assert.ok(await waitFor(() => !store.sync.pendingChanges))
  assert.equal(backend.upserts.length, 1)
  assert.equal(backend.writes.length, 0)
  assert.deepEqual(names(cloudState()), ['云端选手', '老库写入'])
})

test('未登录时不写云端，登录后才推送待同步改动', async () => {
  const store = await freshStore({ revision: 1, writeEnabled: false })

  store.addPlayer({ name: '游客改动', tier: 4 })
  await sleep(400)

  assert.equal(backend.attempts, 0)
  assert.equal(store.sync.pendingChanges, true)
  assert.equal(backend.row.revision, 1)

  store.setCloudWriteEnabled(true)

  assert.ok(await waitFor(() => !store.sync.pendingChanges))
  assert.equal(backend.row.revision, 2)
  assert.deepEqual(names(cloudState()), ['云端选手', '游客改动'])
})
