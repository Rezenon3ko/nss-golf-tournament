import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRepository, createSeasonRepository } from '../src/lib/repository.js'

function createFakeClient() {
  const calls = []
  return {
    calls,
    rpc(fn, params) {
      calls.push([fn, params])
      return Promise.resolve({ data: { ok: true }, error: null })
    },
  }
}

function sampleMatch(extra = {}) {
  return {
    id: 'gm-A-1-1',
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

test('repository：选手 / 分组 / 赛果 / 证据映射到对应 RPC 参数', async () => {
  const client = createFakeClient()
  const repository = createRepository(client, 's-2026')

  await repository.upsertPlayer(
    { id: 'p1', name: '甲', tier: 1, groupId: 'A', bestScore: -10, avatar: 'https://x/a.jpg' },
    3,
  )
  assert.deepEqual(client.calls[0], [
    'upsert_player',
    {
      p_season_id: 's-2026',
      p_player: {
        id: 'p1',
        name: '甲',
        tier: 1,
        group_id: 'A',
        best_score: -10,
        avatar_url: 'https://x/a.jpg',
        sort_order: 3,
      },
    },
  ])

  await repository.publishGroups({
    players: [{ id: 'p1', groupId: 'A' }],
    matches: [sampleMatch()],
  })
  assert.equal(client.calls[1][0], 'publish_groups')
  assert.deepEqual(client.calls[1][1].p_players, [{ id: 'p1', group_id: 'A' }])
  assert.equal(client.calls[1][1].p_matches[0].bracket_order, null)
  assert.equal(client.calls[1][1].p_matches[0].created_at, new Date(1750000000000).toISOString())

  await repository.applyChangeset({
    matches: [sampleMatch({ status: 'complete', winnerId: 'p1' })],
    seasonPatch: { champion_player_id: 'p1' },
  })
  assert.equal(client.calls[2][0], 'apply_match_changeset')
  assert.deepEqual(client.calls[2][1].p_season_patch, { champion_player_id: 'p1' })
  assert.equal(client.calls[2][1].p_matches[0].winner_id, 'p1')

  await repository.applyEvidence({
    op: 'add',
    evidence: {
      id: 'ev-1',
      matchId: 'gm-A-1-1',
      type: 'result',
      name: '赛果截图',
      url: 'https://x/e.jpg',
      by: '主办方',
      time: 1750000001000,
    },
  })
  assert.deepEqual(client.calls[3], [
    'apply_evidence',
    {
      p_season_id: 's-2026',
      p_op: 'add',
      p_evidence: {
        id: 'ev-1',
        match_id: 'gm-A-1-1',
        type: 'result',
        name: '赛果截图',
        url: 'https://x/e.jpg',
        by_name: '主办方',
        created_at: new Date(1750000001000).toISOString(),
      },
      p_evidence_id: null,
    },
  ])
})

test('repository：日志 / 抽签记录 / 删除与错误透传', async () => {
  const client = createFakeClient()
  const repository = createRepository(client, 's-2026')

  await repository.appendLogs([{ id: 'lg-1', time: 1750000000000, by: '主办方', message: '完赛' }])
  assert.deepEqual(client.calls[0][1].p_logs, [
    {
      id: 'lg-1',
      at: new Date(1750000000000).toISOString(),
      by_name: '主办方',
      message: '完赛',
    },
  ])

  await repository.appendDraw({
    id: 'draw-1',
    time: 1750000000000,
    by: '主办方',
    tiers: {},
    groups: {},
  })
  assert.equal(client.calls[1][0], 'append_draw')
  assert.equal(client.calls[1][1].p_draw.id, 'draw-1')

  await repository.deletePlayer('p9')
  assert.deepEqual(client.calls[2], ['delete_player', { p_season_id: 's-2026', p_player_id: 'p9' }])

  const failing = {
    rpc: () => Promise.resolve({ data: null, error: { code: 'PT409', message: '版本冲突' } }),
  }
  const strict = createRepository(failing, 's-2026')
  await assert.rejects(
    () => strict.saveDraft({}),
    (error) => error.code === 'PT409' && error.message === '版本冲突',
  )
})

test('repository：赛季管理（新建 / 改名 / 设为当前 / 归档）', async () => {
  const client = createFakeClient()
  const repository = createSeasonRepository(client)

  await repository.create({ name: '2026 秋季赛', slug: '2026-fall', copyFrom: 's-2026' })
  assert.deepEqual(client.calls[0], [
    'create_season',
    { p_name: '2026 秋季赛', p_slug: '2026-fall', p_copy_from: 's-2026' },
  ])

  await repository.update('s-1', { name: '改名赛季' })
  assert.deepEqual(client.calls[1], [
    'update_season',
    { p_season_id: 's-1', p_name: '改名赛季', p_slug: null },
  ])

  await repository.setCurrent('s-1')
  assert.deepEqual(client.calls[2], ['set_current_season', { p_season_id: 's-1' }])

  await repository.archive('s-1', false)
  assert.deepEqual(client.calls[3], ['archive_season', { p_season_id: 's-1', p_archived: false }])

  await repository.remove('s-1')
  assert.deepEqual(client.calls[4], ['delete_season', { p_season_id: 's-1' }])
})
