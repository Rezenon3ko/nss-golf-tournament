import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMirrorController, diffSeasonState, isEmptyDiff } from '../src/lib/mirror.js'

function player(id, name, groupId = null) {
  return { id, name, avatar: null, bestScore: -8, tier: 2, groupId }
}

function match(id, extra = {}) {
  return {
    id,
    stage: 'group',
    groupId: 'A',
    round: 1,
    playerAId: 'p1',
    playerBId: 'p2',
    sets: [{ a: -9, b: -8, sdWinner: null }],
    status: 'pending',
    forfeitBy: null,
    winnerId: null,
    resultLinks: [],
    disconnect: null,
    createdAt: 1750000000000,
    updatedAt: 1750000000000,
    log: [],
    ...extra,
  }
}

function baseState(extra = {}) {
  return {
    players: [player('p1', '甲', 'A'), player('p2', '乙', 'A')],
    matches: [match('m1')],
    ddlRounds: [{ key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1, ddl: null }],
    tiebreakResolutions: {},
    evidence: [],
    championId: null,
    runnerUpId: null,
    draft: null,
    logs: [{ id: 'lg-1', time: 1750000000000, by: '主办方', message: '初始状态' }],
    drawHistory: [],
    ...extra,
  }
}

function createFakeStorage() {
  const store = new Map()
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  }
}

function createFakeRepository(overrides = {}) {
  const calls = []
  const record =
    (name) =>
    (...args) => {
      calls.push([name, args])
      return Promise.resolve({ ok: true })
    }
  const repository = {
    calls,
    upsertPlayer: record('upsertPlayer'),
    deletePlayer: record('deletePlayer'),
    saveDraft: record('saveDraft'),
    setDdl: record('setDdl'),
    publishGroups: record('publishGroups'),
    applyChangeset: record('applyChangeset'),
    saveTiebreaks: record('saveTiebreaks'),
    applyEvidence: record('applyEvidence'),
    appendLogs: record('appendLogs'),
    appendDraw: record('appendDraw'),
    resetSeason: record('resetSeason'),
    ...overrides,
  }
  return repository
}

test('差异计算：选手增删改与名单位置', () => {
  const prev = baseState()
  const next = baseState({
    players: [player('p2', '乙', 'A'), player('p1', '甲改', 'B'), player('p3', '丙')],
  })
  const diff = diffSeasonState(prev, next)

  assert.equal(diff.playersUpsert.length, 3, '两人位置/资料变化 + 一个新选手')
  assert.deepEqual(
    diff.playersUpsert.map((entry) => [entry.player.id, entry.sortOrder]),
    [
      ['p2', 0],
      ['p1', 1],
      ['p3', 2],
    ],
  )
  assert.deepEqual(diff.playersDelete, [])

  const removed = diffSeasonState(baseState(), baseState({ players: [player('p2', '乙', 'A')] }))
  assert.deepEqual(removed.playersDelete, ['p1'])
  assert.equal(removed.playersUpsert.length, 1, '剩余选手顺序前移需要同步 sort_order')
  assert.equal(isEmptyDiff(diff), false)
})

test('差异计算：DDL / 草稿 / 证据 / 日志 / 抽签 / 赛季补丁', () => {
  const prev = baseState()
  const next = baseState({
    ddlRounds: [
      { key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1, ddl: '2026-09-06T23:59' },
    ],
    draft: { A: ['p1'], B: [], C: [], D: [] },
    evidence: [
      {
        id: 'ev-1',
        matchId: 'm1',
        type: 'result',
        url: 'https://x/e.jpg',
        name: '赛果截图',
        by: '主办方',
        time: 1750000001000,
      },
    ],
    logs: [
      ...baseState().logs,
      { id: 'lg-2', time: 1750000002000, by: '主办方', message: '录入赛果' },
    ],
    drawHistory: [{ id: 'draw-1', time: 1750000003000, by: '主办方', tiers: {}, groups: {} }],
    championId: 'p1',
    runnerUpId: 'p2',
  })
  const diff = diffSeasonState(prev, next)

  assert.equal(diff.ddl.length, 1)
  assert.equal(diff.draftChanged, true)
  assert.deepEqual(
    diff.evidenceUpsert.map((item) => item.id),
    ['ev-1'],
  )
  assert.deepEqual(
    diff.logs.map((entry) => entry.id),
    ['lg-2'],
  )
  assert.deepEqual(
    diff.draws.map((draw) => draw.id),
    ['draw-1'],
  )
  assert.deepEqual(diff.seasonPatch, {
    champion_player_id: 'p1',
    runner_up_player_id: 'p2',
  })
})

test('差异计算：比赛变化与同分抽签解决', () => {
  const prev = baseState()
  const next = baseState({
    matches: [match('m1', { status: 'complete', winnerId: 'p1' })],
    tiebreakResolutions: { A: ['p2', 'p1'] },
  })
  const diff = diffSeasonState(prev, next)

  assert.deepEqual(
    diff.matches.map((item) => item.id),
    ['m1'],
  )
  assert.deepEqual(diff.tiebreaks, [
    { group_id: 'A', player_id: 'p2', position: 0 },
    { group_id: 'A', player_id: 'p1', position: 1 },
  ])

  const cleared = diffSeasonState(
    baseState({ tiebreakResolutions: { A: ['p2', 'p1'] } }),
    baseState(),
  )
  assert.deepEqual(cleared.tiebreaks, [], '清空由整体操作负责，逐行差异不处理')
})

test('镜像同步：按差异调用 RPC，成功后推进基线且重复同步不再调用', async () => {
  const repository = createFakeRepository()
  const storage = createFakeStorage()
  const controller = createMirrorController({
    repository,
    storage,
    baselineKey: 'mirror.test',
  })

  const prev = baseState()
  const next = baseState({
    matches: [match('m1', { status: 'complete', winnerId: 'p1' })],
    championId: 'p1',
    logs: [...baseState().logs, { id: 'lg-2', time: 1, by: '主办方', message: '完赛' }],
  })

  controller.setBaseline(prev)
  assert.equal(controller.pending(prev), false)
  assert.equal(controller.pending(next), true)

  await controller.sync(next)
  const names = repository.calls.map(([name]) => name)
  assert.ok(names.includes('applyChangeset'))
  assert.ok(names.includes('appendLogs'))
  assert.equal(controller.pending(next), false, '同步后基线已推进')
  assert.equal(JSON.parse(storage.getItem('mirror.test')).championId, 'p1', '基线写入 localStorage')

  const count = repository.calls.length
  await controller.sync(next)
  assert.equal(repository.calls.length, count, '无差异时不再调用 RPC')
})

test('镜像基线是深拷贝：原地修改（push / 字段赋值）也能被检测并同步', async () => {
  const repository = createFakeRepository()
  const controller = createMirrorController({
    repository,
    storage: createFakeStorage(),
    baselineKey: 'mirror.test',
  })

  const state = baseState()
  controller.setBaseline(state)
  assert.equal(controller.pending(state), false)

  // 模拟 store 的原地修改：日志 unshift、比赛字段赋值、选手改名
  state.logs.unshift({ id: 'lg-2', time: 1750000001000, by: '主办方', message: '清空手动分组选择' })
  state.matches[0].status = 'complete'
  state.players[0].name = '甲改'

  assert.equal(controller.pending(state), true, '原地修改必须被检测到')
  await controller.sync(state)

  const names = repository.calls.map(([name]) => name)
  assert.ok(names.includes('applyChangeset'), '比赛改动要推给各表')
  assert.ok(names.includes('appendLogs'), '新增日志要推给各表')
  assert.ok(names.includes('upsertPlayer'), '选手改名要推给各表')
  assert.equal(controller.pending(state), false, '同步后基线已推进')
})

test('镜像同步：发布分组 / 重置赛事走整体 RPC，跳过逐行赛程差异', async () => {
  const repository = createFakeRepository()
  const controller = createMirrorController({
    repository,
    storage: createFakeStorage(),
    baselineKey: 'mirror.test',
  })
  const prev = baseState()

  controller.setBaseline(prev)
  controller.setWholesale('publish')
  const published = baseState({
    matches: [match('gm-A-1-1'), match('gm-A-1-2')],
    draft: null,
  })
  await controller.sync(published)
  assert.equal(repository.calls.filter(([name]) => name === 'publishGroups').length, 1)
  assert.equal(repository.calls.filter(([name]) => name === 'applyChangeset').length, 0)
  assert.equal(controller.wholesalePending(), null, '整体操作成功后清除标记')

  controller.setWholesale('reset')
  await controller.sync(
    baseState({ matches: [], players: [player('p1', '甲'), player('p2', '乙')] }),
  )
  assert.equal(repository.calls.filter(([name]) => name === 'resetSeason').length, 1)
  assert.equal(controller.wholesalePending(), null)
})

test('镜像同步：失败不推进基线、整体标记保留；删除 PT404 视为已完成', async () => {
  const failing = createFakeRepository({
    applyChangeset: () => Promise.reject(Object.assign(new Error('boom'), { code: 'PT500' })),
  })
  const storage = createFakeStorage()
  const controller = createMirrorController({
    repository: failing,
    storage,
    baselineKey: 'mirror.test',
  })
  const prev = baseState()
  const next = baseState({ matches: [match('m1', { status: 'complete', winnerId: 'p1' })] })

  controller.setBaseline(prev)
  await assert.rejects(() => controller.sync(next))
  assert.equal(controller.pending(next), true, '失败后仍需重试')
  assert.equal(JSON.parse(storage.getItem('mirror.test')).championId, null, '基线未推进')

  const missing = createFakeRepository({
    deletePlayer: () => Promise.reject(Object.assign(new Error('missing'), { code: 'PT404' })),
    applyEvidence: () => Promise.reject(Object.assign(new Error('missing'), { code: 'PT404' })),
  })
  const tolerant = createMirrorController({
    repository: missing,
    storage: createFakeStorage(),
    baselineKey: 'mirror.test',
  })
  tolerant.setBaseline(prev)
  await tolerant.sync(baseState({ players: [player('p2', '乙', 'A')] }))
  assert.equal(tolerant.pending(baseState({ players: [player('p2', '乙', 'A')] })), false)
})

test('镜像同步：整体操作失败时保留标记，重试成功后才清除', async () => {
  let failFirst = true
  const repository = createFakeRepository({
    resetSeason: () => {
      if (failFirst) {
        failFirst = false
        return Promise.reject(Object.assign(new Error('boom'), { code: 'PT500' }))
      }
      return Promise.resolve({ ok: true })
    },
  })
  const controller = createMirrorController({
    repository,
    storage: createFakeStorage(),
    baselineKey: 'mirror.test',
  })

  controller.setBaseline(baseState())
  controller.setWholesale('reset')
  const after = baseState({ matches: [], players: [player('p1', '甲'), player('p2', '乙')] })

  await assert.rejects(() => controller.sync(after))
  assert.equal(controller.wholesalePending(), 'reset', '失败后仍需按整体操作重试')

  await controller.sync(after)
  assert.equal(controller.wholesalePending(), null)
  assert.equal(controller.pending(after), false)
})
