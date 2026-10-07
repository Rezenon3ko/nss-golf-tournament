import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchCurrentSeason,
  fetchSeasonBundle,
  fetchSeasonPlayers,
  fetchSeasons,
} from '../src/lib/seasonData.js'
import { rowsToSnapshot } from '../src/lib/seasonSnapshot.js'

function createFakeClient(tables) {
  function builder(table) {
    const state = { table, filters: [], ins: [], order: null, limit: null }
    const api = {
      select() {
        return api
      },
      eq(column, value) {
        state.filters.push([column, value])
        return api
      },
      in(column, values) {
        state.ins.push([column, values])
        return api
      },
      order(column, options) {
        state.order = [column, options]
        return api
      },
      limit(count) {
        state.limit = count
        return api
      },
      then(resolve, reject) {
        if (tables[state.table] === 'ERROR') {
          return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(
            resolve,
            reject,
          )
        }
        let rows = [...(tables[state.table] || [])]
        for (const [column, value] of state.filters) {
          rows = rows.filter((row) => row[column] === value)
        }
        for (const [column, values] of state.ins) {
          rows = rows.filter((row) => values.includes(row[column]))
        }
        if (state.order) {
          const [column, options] = state.order
          const direction = options?.ascending === false ? -1 : 1
          rows.sort(
            (a, b) => (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * direction,
          )
        }
        if (state.limit != null) rows = rows.slice(0, state.limit)
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
      },
    }
    return api
  }
  return { from: builder }
}

function sampleTables() {
  return {
    seasons: [
      {
        id: 's-2026',
        slug: '2026',
        name: '2026 赛季',
        is_current: true,
        is_archived: false,
        champion_player_id: 'p1',
        runner_up_player_id: 'p2',
        revision: 3,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 's-2025',
        slug: '2025',
        name: '2025 赛季',
        is_current: false,
        is_archived: true,
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
    players: [
      { id: 'p2', season_id: 's-2026', name: '乙', tier: 2, group_id: 'A', sort_order: 1 },
      { id: 'p1', season_id: 's-2026', name: '甲', tier: 1, group_id: 'A', sort_order: 0 },
    ],
    matches: [
      {
        id: 'final-1',
        season_id: 's-2026',
        stage: 'final',
        bracket_order: 1,
        player_a_id: 'p1',
        player_b_id: null,
        status: 'walkover',
        sets: [],
        result_links: [],
        log: [],
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-02T00:00:00Z',
      },
    ],
    ddl_rounds: [
      {
        season_id: 's-2026',
        key: 'group1',
        label: '小组赛第1轮',
        stage: 'group',
        round: 1,
        ddl: '2026-09-06T23:59:00',
      },
    ],
    tiebreak_resolutions: [
      { season_id: 's-2026', group_id: 'A', player_id: 'p2', position: 0 },
      { season_id: 's-2026', group_id: 'A', player_id: 'p1', position: 1 },
    ],
    draws: [{ id: 'draw-1', season_id: 's-2026', at: '2026-08-01T00:00:00Z' }],
    evidence: [],
    logs: [{ id: 'lg-1', season_id: 's-2026', at: '2026-08-01T00:00:00Z', message: '初始状态' }],
  }
}

test('读取：赛季列表与当前赛季定位', async () => {
  const client = createFakeClient(sampleTables())

  const seasons = await fetchSeasons(client)
  assert.deepEqual(
    seasons.map((season) => season.id),
    ['s-2026', 's-2025'],
    '按创建时间倒序',
  )

  const preferred = await fetchCurrentSeason(client, 's-2026')
  assert.equal(preferred.id, 's-2026')

  const archivedPreferred = await fetchCurrentSeason(client, 's-2025')
  assert.equal(archivedPreferred.id, 's-2026', '本机选中的赛季已归档时回退到当前赛季')

  const noPreferred = await fetchCurrentSeason(client, null)
  assert.equal(noPreferred.id, 's-2026')
})

test('读取：整季数据包组装成 store 快照（含递补亚军）', async () => {
  const client = createFakeClient(sampleTables())
  const bundle = await fetchSeasonBundle(client, 's-2026')
  const snapshot = rowsToSnapshot(bundle, { adminAvatar: 'https://x/admin.jpg' })

  assert.deepEqual(
    snapshot.players.map((player) => player.id),
    ['p1', 'p2'],
    '按 sort_order 排列',
  )
  assert.equal(snapshot.championId, 'p1')
  assert.equal(snapshot.matches.length, 1)
  assert.equal(
    snapshot.matches[0].runnerUpId,
    'p2',
    '半区作废的递补亚军从 season.runner_up_player_id 放回决赛行',
  )
  assert.deepEqual(snapshot.tiebreakResolutions, { A: ['p2', 'p1'] })
  assert.equal(snapshot.ddlRounds[0].ddl, '2026-09-06T23:59')
  assert.equal(snapshot.logs[0].message, '初始状态')
  assert.equal(snapshot.adminAvatar, 'https://x/admin.jpg')
})

test('读取：操作日志按时间从新到旧排列', async () => {
  const tables = sampleTables()
  tables.logs = [
    { id: 'lg-1', season_id: 's-2026', at: '2026-08-01T00:00:00Z', message: '旧日志' },
    { id: 'lg-2', season_id: 's-2026', at: '2026-09-01T00:00:00Z', message: '新日志' },
  ]
  const bundle = await fetchSeasonBundle(createFakeClient(tables), 's-2026')
  const snapshot = rowsToSnapshot(bundle, {})

  assert.deepEqual(
    snapshot.logs.map((log) => log.message),
    ['新日志', '旧日志'],
    '最新的日志排在最前',
  )
})

test('读取：没有赛季时返回 null，不抛错', async () => {
  const client = createFakeClient({ seasons: [] })
  assert.equal(await fetchCurrentSeason(client, null), null)
  await assert.rejects(() => fetchSeasonBundle(client, 's-none'), /赛季不存在/)
})

test('读取：logs 无权限（匿名）时按空数组处理，不影响公开页面', async () => {
  const tables = sampleTables()
  tables.logs = 'ERROR'
  const client = createFakeClient(tables)

  const bundle = await fetchSeasonBundle(client, 's-2026')
  assert.deepEqual(bundle.logs, [])
  assert.equal(bundle.players.length, 2, '其余数据照常返回')
})

test('读取：一次取回多个赛季的名单（归档页展示冠军用）', async () => {
  const tables = sampleTables()
  tables.players.push({
    id: 'p3',
    season_id: 's-2025',
    name: '丙',
    tier: 1,
    group_id: null,
    sort_order: 0,
  })
  const client = createFakeClient(tables)

  const players = await fetchSeasonPlayers(client, ['s-2026', 's-2025'])
  assert.deepEqual(players.map((player) => player.id).sort(), ['p1', 'p2', 'p3'])
  assert.deepEqual(await fetchSeasonPlayers(client, []), [])
})
