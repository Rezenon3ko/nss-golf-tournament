import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  canonicalizeSnapshot,
  diffCanonical,
  matchUpdateOrder,
  normalizeDdl,
  rowsToSnapshot,
  runnerUpOf,
  snapshotToRows,
} from '../src/lib/seasonSnapshot.js'
import { bulkUpsert } from '../scripts/lib/supabase-rest.mjs'
import { buildPbStats, buildSdStats } from '../src/lib/stats.js'

const base = 1750000000000

function fixtureSnapshot() {
  return {
    players: [
      { id: 'p1', name: '甲', avatar: 'https://x/a.jpg', bestScore: -10, tier: 1, groupId: 'A' },
      { id: 'p2', name: '乙', avatar: null, bestScore: -8, tier: 2, groupId: 'A' },
      { id: 'p3', name: '丙', avatar: null, bestScore: -12, tier: 1, groupId: 'B' },
      { id: 'p4', name: '丁', avatar: null, bestScore: -6, tier: 2, groupId: 'B' },
    ],
    draft: { A: ['p1', 'p2'], B: ['p3', 'p4'], C: [], D: [] },
    matches: [
      {
        id: 'gm-A-1-1',
        stage: 'group',
        groupId: 'A',
        round: 1,
        playerAId: 'p1',
        playerBId: 'p2',
        sets: [
          { a: -12, b: -12, sdWinner: 'p1' },
          { a: -9, b: -10 },
        ],
        status: 'complete',
        forfeitBy: null,
        winnerId: 'p1',
        resultLinks: ['https://x/r1.jpg'],
        disconnect: null,
        createdAt: base,
        updatedAt: base + 100000,
        log: [{ time: base + 100000, by: '主办方', message: '录入并发布赛果' }],
      },
      {
        id: 'gm-B-1-1',
        stage: 'group',
        groupId: 'B',
        round: 1,
        playerAId: 'p3',
        playerBId: 'p4',
        sets: [{ a: -7, b: -5 }],
        status: 'complete',
        forfeitBy: null,
        winnerId: 'p3',
        resultLinks: [],
        disconnect: {
          setIndex: 0,
          holesCompleted: 5,
          note: '中途掉线',
          links: ['https://x/d.jpg'],
        },
        createdAt: base + 200000,
        updatedAt: base + 300000,
        log: [],
      },
      {
        id: 'ko-qf-1',
        stage: 'qf',
        groupId: null,
        round: null,
        order: 1,
        playerAId: 'p1',
        playerBId: 'p3',
        sets: [{ a: -5, b: -3 }],
        status: 'complete',
        forfeitBy: null,
        winnerId: 'p1',
        resultLinks: [],
        disconnect: null,
        createdAt: base + 400000,
        updatedAt: base + 500000,
        log: [],
      },
      {
        id: 'ko-final',
        stage: 'final',
        groupId: null,
        round: null,
        order: 1,
        playerAId: 'p1',
        playerBId: null,
        sets: [],
        status: 'walkover',
        forfeitBy: null,
        winnerId: 'p1',
        runnerUpId: 'p3',
        walkover: '对手半区作废，直接夺冠',
        resultLinks: [],
        disconnect: null,
        createdAt: base + 600000,
        updatedAt: base + 700000,
        log: [],
      },
    ],
    ddlRounds: [
      { key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1, ddl: '2026-08-30T23:59' },
      { key: 'group2', label: '小组赛第2轮', stage: 'group', round: 2, ddl: null },
      { key: 'group3', label: '小组赛第3轮', stage: 'group', round: 3, ddl: null },
      { key: 'qf', label: '八强', stage: 'qf', round: null, ddl: '2026-09-20T23:59' },
      { key: 'sf', label: '半决赛', stage: 'sf', round: null, ddl: null },
      { key: 'final', label: '决赛', stage: 'final', round: null, ddl: null },
    ],
    tiebreakResolutions: { A: ['p2', 'p1'] },
    evidence: [
      {
        id: 'ev-1',
        matchId: 'gm-A-1-1',
        type: 'result',
        url: 'https://x/e.jpg',
        name: '赛果截图',
        by: '主办方',
        time: base + 800000,
      },
    ],
    logs: [{ id: 'lg-1', time: base + 800000, by: '主办方', message: '录入并发布赛果' }],
    championId: 'p1',
    drawHistory: [
      {
        id: 'draw-1',
        time: base,
        by: '主办方',
        tiers: { 1: ['p1', 'p3'], 2: ['p2', 'p4'], 3: [], 4: [] },
        groups: { A: ['p1', 'p2'], B: ['p3', 'p4'], C: [], D: [] },
      },
    ],
    adminAvatar: 'https://x/admin.jpg',
  }
}

const meta = { seasonId: 's-2026', slug: '2026', name: '2026 赛季' }

test('迁移映射：旧快照字段 → 表行列名与顺序', () => {
  const rows = snapshotToRows(fixtureSnapshot(), meta)

  assert.equal(rows.season.id, 's-2026')
  assert.equal(rows.season.slug, '2026')
  assert.equal(rows.season.champion_player_id, 'p1')
  assert.equal(rows.season.runner_up_player_id, 'p3', '半区作废时取递补亚军')
  assert.deepEqual(rows.season.draft_groups, { A: ['p1', 'p2'], B: ['p3', 'p4'], C: [], D: [] })

  assert.equal(rows.players.length, 4)
  assert.deepEqual(rows.players[0], {
    id: 'p1',
    season_id: 's-2026',
    name: '甲',
    tier: 1,
    group_id: 'A',
    best_score: -10,
    avatar_url: 'https://x/a.jpg',
    sort_order: 0,
  })

  const qf = rows.matches.find((m) => m.id === 'ko-qf-1')
  assert.equal(qf.bracket_order, 1, 'order → bracket_order')
  assert.equal(qf.stage, 'qf')
  const group = rows.matches.find((m) => m.id === 'gm-A-1-1')
  assert.equal(group.round, 1)
  assert.equal(group.bracket_order, null)
  assert.equal(group.created_at, new Date(base).toISOString())

  assert.equal(rows.ddlRounds[0].ddl, '2026-08-30T23:59')
  assert.equal(rows.ddlRounds[1].ddl, null)

  assert.deepEqual(rows.tiebreaks, [
    { season_id: 's-2026', group_id: 'A', player_id: 'p2', position: 0 },
    { season_id: 's-2026', group_id: 'A', player_id: 'p1', position: 1 },
  ])

  assert.equal(rows.draws[0].by_name, '主办方')
  assert.equal(rows.evidence[0].match_id, 'gm-A-1-1')
  assert.equal(rows.logs[0].message, '录入并发布赛果')
})

test('迁移映射：快照 → 行 → 快照 往返一致（含统计口径）', () => {
  const snapshot = fixtureSnapshot()
  const rows = snapshotToRows(snapshot, meta)
  const rebuilt = rowsToSnapshot(rows, { adminAvatar: snapshot.adminAvatar })

  const diff = diffCanonical(canonicalizeSnapshot(snapshot), canonicalizeSnapshot(rebuilt))
  assert.equal(diff, null, diff ? `首个差异：${JSON.stringify(diff)}` : '')

  const legacyStats = {
    sd: buildSdStats({ matches: snapshot.matches, players: snapshot.players }),
    pb: buildPbStats({ matches: snapshot.matches, players: snapshot.players }),
  }
  const rebuiltStats = {
    sd: buildSdStats({ matches: rebuilt.matches, players: rebuilt.players }),
    pb: buildPbStats({ matches: rebuilt.matches, players: rebuilt.players }),
  }
  assert.deepEqual(rebuiltStats, legacyStats)
})

test('亚军推导：完赛取败者、轮空取递补、未完成返回空', () => {
  const make = (final) => ({ matches: [{ id: 'f', stage: 'final', ...final }] })

  assert.equal(
    runnerUpOf(make({ playerAId: 'a', playerBId: 'b', status: 'complete', winnerId: 'a' })),
    'b',
  )
  assert.equal(
    runnerUpOf(
      make({ playerAId: 'a', playerBId: null, status: 'walkover', winnerId: 'a', runnerUpId: 'c' }),
    ),
    'c',
  )
  assert.equal(runnerUpOf(make({ playerAId: 'a', playerBId: 'b', status: 'pending' })), null)
  assert.equal(runnerUpOf({ matches: [] }), null)
})

test('迁移映射：递补亚军写进 season.runner_up_player_id，读回时回到决赛行', () => {
  const snapshot = fixtureSnapshot()
  const rows = snapshotToRows(snapshot, meta)
  assert.equal(rows.season.runner_up_player_id, 'p3')
  assert.equal(rows.season.champion_player_id, 'p1')

  const rebuilt = rowsToSnapshot(rows, {})
  const final = rebuilt.matches.find((match) => match.stage === 'final')
  assert.equal(final.runnerUpId, 'p3', '比赛表没有该列，需由 season 行回填')
})

test('空快照与缺失字段不会中断迁移', () => {
  const rows = snapshotToRows({}, meta)
  assert.equal(rows.players.length, 0)
  assert.equal(rows.matches.length, 0)
  assert.equal(rows.season.champion_player_id, null)
  assert.equal(rows.season.runner_up_player_id, null)

  const rebuilt = rowsToSnapshot(rows, {})
  assert.equal(rebuilt.championId, null)
  assert.deepEqual(rebuilt.players, [])
  assert.equal(
    diffCanonical(canonicalizeSnapshot({}), canonicalizeSnapshot(rebuilt)),
    null,
    '空快照往返一致',
  )
})

test('DDL 规范化：保留墙上时间、支持空值', () => {
  assert.equal(normalizeDdl('2026-08-30T23:59'), '2026-08-30T23:59')
  assert.equal(normalizeDdl('2026-08-30T23:59:00'), '2026-08-30T23:59')
  assert.equal(normalizeDdl(null), null)
  assert.equal(normalizeDdl(''), null)
})

test('对账口径：updated_at 不逐毫秒比较，但顺序必须保留', () => {
  const snapshot = fixtureSnapshot()
  const earlier = {
    ...snapshot,
    matches: snapshot.matches.map((match) =>
      match.id === 'ko-qf-1' ? { ...match, updatedAt: base + 50000 } : match,
    ),
  }
  assert.equal(
    diffCanonical(canonicalizeSnapshot(snapshot), canonicalizeSnapshot(earlier)),
    null,
    '时间差本身不参与逐字段比较（双写下客户端时间与服务端时间不会逐毫秒一致）',
  )
  assert.notDeepEqual(
    matchUpdateOrder(snapshot),
    matchUpdateOrder(earlier),
    '相对顺序变化必须能被识别',
  )

  // 模拟「历史时间被全部覆盖成同一时刻」：顺序退化为按 id 排序，应被识别
  const flattened = {
    ...snapshot,
    matches: snapshot.matches.map((match) => ({ ...match, updatedAt: base + 1 })),
  }
  assert.notDeepEqual(matchUpdateOrder(snapshot), matchUpdateOrder(flattened))
})

test('批量 upsert：键集合取并集、缺失补 null，并带上冲突目标', async () => {
  const calls = []
  const rest = {
    async post(path, body, options) {
      calls.push({ path, body, options })
    },
  }

  const count = await bulkUpsert(
    rest,
    'players',
    [
      { id: 'p1', name: '甲', group_id: 'A' },
      { id: 'p2', name: '乙' },
    ],
    'id',
  )

  assert.equal(count, 2)
  assert.equal(calls[0].path, 'players?on_conflict=id')
  assert.equal(calls[0].options.prefer, 'resolution=merge-duplicates,return=minimal')
  assert.deepEqual(calls[0].body, [
    { id: 'p1', name: '甲', group_id: 'A' },
    { id: 'p2', name: '乙', group_id: null },
  ])
})
