import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyRealtimeChanges } from '../src/lib/realtimeMerge.js'
import { createEventBatcher } from '../src/lib/realtime.js'

function createSlices() {
  return {
    players: [{ id: 'p1', name: '甲', avatar: null, bestScore: -8, tier: 2, groupId: 'A' }],
    matches: [
      {
        id: 'final-1',
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
        resultLinks: [],
        disconnect: null,
        log: [],
        runnerUpId: 'p2',
        createdAt: 1750000000000,
        updatedAt: 1750000000000,
      },
    ],
    ddlRounds: [{ key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1, ddl: null }],
    evidence: [],
  }
}

function playerRow(extra = {}) {
  return {
    id: 'p1',
    season_id: 's-2026',
    name: '甲',
    tier: 2,
    group_id: 'A',
    best_score: -8,
    avatar_url: null,
    ...extra,
  }
}

test('实时合并：选手写入按 id 更新 / 新增 / 删除', () => {
  const slices = createSlices()

  const unchanged = applyRealtimeChanges(slices, [
    { table: 'players', eventType: 'UPDATE', new: playerRow() },
  ])
  assert.equal(unchanged.changed, false, '内容一致时不触发更新（自己的写入回声）')

  const updated = applyRealtimeChanges(slices, [
    { table: 'players', eventType: 'UPDATE', new: playerRow({ name: '甲改', tier: 1 }) },
  ])
  assert.equal(updated.changed, true)
  assert.equal(slices.players[0].name, '甲改')
  assert.equal(slices.players[0].tier, 1)

  applyRealtimeChanges(slices, [
    { table: 'players', eventType: 'INSERT', new: playerRow({ id: 'p9', name: '新人' }) },
  ])
  assert.deepEqual(
    slices.players.map((player) => player.id),
    ['p1', 'p9'],
  )

  applyRealtimeChanges(slices, [{ table: 'players', eventType: 'DELETE', old: { id: 'p1' } }])
  assert.deepEqual(
    slices.players.map((player) => player.id),
    ['p9'],
  )
})

test('实时合并：比赛更新保留本地的递补亚军；DDL 按 key 更新', () => {
  const slices = createSlices()
  const result = applyRealtimeChanges(slices, [
    {
      table: 'matches',
      eventType: 'UPDATE',
      new: {
        id: 'final-1',
        stage: 'final',
        group_id: null,
        round: null,
        bracket_order: 1,
        player_a_id: 'p1',
        player_b_id: null,
        status: 'walkover',
        forfeit_by: null,
        winner_id: 'p1',
        walkover_note: '对手半区作废，直接夺冠',
        sets: [],
        disconnect: null,
        result_links: [],
        log: [],
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-02T00:00:00.000Z',
      },
    },
    {
      table: 'ddl_rounds',
      eventType: 'UPDATE',
      new: {
        season_id: 's-2026',
        key: 'group1',
        label: '小组赛第1轮',
        stage: 'group',
        round: 1,
        ddl: '2026-09-06T23:59:00',
      },
    },
  ])

  assert.equal(result.changed, true)
  assert.equal(slices.matches[0].runnerUpId, 'p2', '比赛表没有该列，需保留本地值')
  assert.equal(slices.matches[0].walkover, '对手半区作废，直接夺冠')
  assert.equal(slices.ddlRounds[0].ddl, '2026-09-06T23:59')
})

test('实时合并：抽签解决记录标记为整表刷新，赛季行作为补丁返回', () => {
  const slices = createSlices()
  const result = applyRealtimeChanges(slices, [
    { table: 'tiebreak_resolutions', eventType: 'INSERT', new: { group_id: 'A', player_id: 'p1' } },
    {
      table: 'seasons',
      eventType: 'UPDATE',
      new: { id: 's-2026', champion_player_id: 'p1', runner_up_player_id: 'p2' },
    },
  ])

  assert.equal(result.tiebreakRefetch, true)
  assert.equal(result.season.champion_player_id, 'p1')
})

test('事件批量合并：同一批只回调一次', async () => {
  const batches = []
  const batcher = createEventBatcher((batch) => batches.push(batch), 10)

  batcher.push({ table: 'players' })
  batcher.push({ table: 'matches' })
  assert.equal(batches.length, 0, '未到窗口不回调')

  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(batches.length, 1)
  assert.equal(batches[0].length, 2)

  batcher.flush()
  assert.equal(batches.length, 1, '空队列 flush 不再回调')
})
