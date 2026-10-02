import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPbStats, buildSdStats } from '../src/lib/stats.js'

function set(a, b, sdWinner = null) {
  return { a, b, sdWinner }
}

function match(id, stage, aId, bId, sets, extra = {}) {
  return {
    id,
    stage,
    groupId: extra.groupId ?? null,
    round: extra.round ?? null,
    order: extra.order ?? null,
    playerAId: aId,
    playerBId: bId,
    sets,
    status: extra.status ?? 'complete',
  }
}

const players = [
  { id: 'p1', name: '甲', bestScore: -16 },
  { id: 'p2', name: '乙', bestScore: -10 },
  { id: 'p3', name: '丙', bestScore: null },
]

// ---------- SD 统计 ----------

test('SD：按 sdWinner 统计胜场与出场次数', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(-12, -12, 'p1'), set(-13, -10)]),
    match('m2', 'group', 'p1', 'p3', [set(-11, -11, 'p3'), set(-11, -12)]),
    // 平局但没记 SD 胜者：计入总 SD 数，标记为未判定，不算任何人的胜场
    match('m3', 'group', 'p2', 'p3', [set(-8, -8)]),
  ]

  const { rows, totalSd, undecided } = buildSdStats({ matches, players })

  assert.equal(totalSd, 3, '三局打平（其中一局未记 SD 胜者）')
  assert.equal(undecided, 1, '其中一局没记 sdWinner')
  const p1 = rows.find((r) => r.playerId === 'p1')
  const p2 = rows.find((r) => r.playerId === 'p2')
  const p3 = rows.find((r) => r.playerId === 'p3')
  assert.equal(p1.wins, 1)
  assert.equal(p1.played, 2, '两次 9 洞平局：m1 第 1 局、m2 第 1 局；-13:-10 那局没打平')
  assert.equal(p3.wins, 1)
  assert.equal(p3.played, 2)
  assert.equal(p2.wins, 0, '未判定的平局不计胜场')
  assert.equal(p2.played, 2, 'm1 第 1 局与 m3 第 1 局都打平')
})

test('SD：未记录成绩的局（判负 / 轮空 / 空局）不计入', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(null, null), set(-9, null)], { status: 'pending' }),
    match('m2', 'qf', 'p1', 'p2', [set(null, null, 'p1')], { status: 'forfeit' }),
    match('m3', 'qf', 'p1', null, [set(null, null)], { status: 'walkover' }),
  ]

  const { rows, totalSd } = buildSdStats({ matches, players })

  assert.equal(totalSd, 0)
  assert.equal(rows.length, 0)
})

test('SD：排序为 胜场 → 胜率 → 局数，且明细带场次信息', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(-12, -12, 'p1')], { groupId: 'A', round: 2 }),
    match('m2', 'final', 'p1', 'p3', [set(-9, -9, 'p1')], { order: 1 }),
    match('m3', 'group', 'p2', 'p3', [set(-8, -8, 'p2')], { groupId: 'B', round: 1 }),
  ]

  const { rows } = buildSdStats({ matches, players })

  assert.deepEqual(
    rows.map((r) => r.playerId),
    ['p1', 'p2', 'p3'],
  )
  const p1 = rows[0]
  assert.equal(p1.wins, 2)
  assert.deepEqual(p1.details[0], {
    matchId: 'm1',
    stage: 'group',
    groupId: 'A',
    round: 2,
    order: null,
    setIndex: 0,
    score: -12,
    opponentId: 'p2',
  })
  assert.equal(p1.details[1].stage, 'final')
})

test('SD：胜场相同时先比胜率，再比局数', () => {
  const matches = [
    // 三人各有 1 胜，局数不同：p1 1/1(100%)、p2 1/2(50%)、p3 1/3(33%)
    match('m1', 'group', 'p1', 'p3', [set(-12, -12, 'p1')]),
    match('m2', 'group', 'p2', 'p3', [set(-9, -9, 'p3')]),
    match('m3', 'group', 'p3', 'p2', [set(-8, -8, 'p2')]),
  ]

  const { rows } = buildSdStats({ matches, players })

  assert.deepEqual(
    rows.map((r) => [r.playerId, r.wins, r.played]),
    [
      ['p1', 1, 1],
      ['p2', 1, 2],
      ['p3', 1, 3],
    ],
  )
})

test('SD：胜场与胜率都相同（都是 0 胜）时，局数多者在前', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(-12, -12)]),
    match('m2', 'group', 'p1', 'p3', [set(-11, -11)]),
    match('m3', 'group', 'p1', 'p3', [set(-10, -10)]),
  ]

  const { rows } = buildSdStats({ matches, players })

  assert.deepEqual(
    rows.map((r) => [r.playerId, r.wins, r.played]),
    [
      ['p1', 0, 3],
      ['p3', 0, 2],
      ['p2', 0, 1],
    ],
  )
})

test('SD：脏数据不抛错', () => {
  assert.deepEqual(buildSdStats().rows, [])
  assert.deepEqual(buildSdStats({ matches: [{}], players: [] }).rows, [])
  assert.deepEqual(
    buildSdStats({ matches: [{ id: 'x', sets: 'nope' }], players: [{ id: 'p1' }] }).rows,
    [],
  )
})

// ---------- PB 突破统计 ----------

const pbPlayers = [
  { id: 'p1', name: '甲', bestScore: -16 },
  { id: 'p2', name: '乙', bestScore: -10 },
  { id: 'p3', name: '丙', bestScore: null },
  { id: 'p4', name: '丁' },
]

test('PB：只有严格优于报名 PB 的局才算突破', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [
      set(-17, -10), // p1 突破（-17 < -16）；p2 平 PB（-10），不算
      set(-16, -11), // p1 平 PB 不算；p2 突破（-11 < -10）
      set(-15, -12), // 双方都没突破 p1(-15 > -16)、p2(-12 < -10 → 其实突破了)
    ]),
  ]

  const { rows, totalBreaks } = buildPbStats({ matches, players: pbPlayers })

  assert.equal(totalBreaks, 3, 'p1 一次（-17）+ p2 两次（-11、-12）')
  assert.equal(rows.length, 2)
  const p1 = rows.find((r) => r.playerId === 'p1')
  const p2 = rows.find((r) => r.playerId === 'p2')
  assert.equal(p1.playerId, 'p1')
  assert.equal(p1.count, 1)
  assert.equal(p1.pb, -16)
  assert.equal(p1.bestScore, -17)
  assert.equal(p1.bestDelta, -1)
  assert.equal(p1.breaks[0].setIndex, 0)
  assert.equal(p1.breaks[0].opponentId, 'p2')

  assert.equal(p2.count, 2, '平 PB 的那局不算，-11 与 -12 才算')
  assert.deepEqual(
    p2.breaks.map((b) => b.score),
    [-12, -11],
  )
})

test('PB：同一人多局突破会累加，并按突破幅度排序明细', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(-18, -9)], { groupId: 'A', round: 1 }),
    match('m2', 'group', 'p1', 'p2', [set(-17, -9)], { groupId: 'A', round: 2 }),
    match('m3', 'group', 'p1', 'p2', [set(-25, -9)], { groupId: 'A', round: 3 }),
  ]

  const { rows, totalBreaks } = buildPbStats({ matches, players: pbPlayers })

  assert.equal(totalBreaks, 3)
  assert.equal(rows[0].count, 3)
  assert.equal(rows[0].bestDelta, -9, '最大突破幅度是 -25 相对 PB -16')
  assert.deepEqual(
    rows[0].breaks.map((b) => b.score),
    [-25, -18, -17],
  )
})

test('PB：没填 PB 的选手被单独列出，不参与排名', () => {
  const matches = [match('m1', 'group', 'p3', 'p4', [set(-30, -40)])]

  const { rows, missingPb } = buildPbStats({ matches, players: pbPlayers })

  assert.equal(rows.length, 0)
  assert.deepEqual(
    missingPb.map((p) => p.playerId),
    ['p3', 'p4'],
  )
})

test('PB：排序为 次数 → 最大突破幅度 → 姓名', () => {
  const matches = [
    // p1 一次突破，p2 两次突破但幅度小
    match('m1', 'group', 'p1', 'p2', [set(-20, -11), set(-1, -11)]),
    match('m2', 'group', 'p2', 'p1', [set(-5, -12)]),
  ]

  const { rows } = buildPbStats({ matches, players: pbPlayers })

  assert.deepEqual(
    rows.map((r) => [r.playerId, r.count]),
    [
      ['p2', 2],
      ['p1', 1],
    ],
  )
})

test('PB：判负 / 未开赛 / 空值不影响统计，脏数据不抛错', () => {
  const matches = [
    match('m1', 'group', 'p1', 'p2', [set(null, null)], { status: 'forfeit' }),
    match('m2', 'group', 'p1', 'p2', [set(-20, null)], { status: 'pending' }),
  ]

  const { rows, totalBreaks } = buildPbStats({ matches, players: pbPlayers })

  assert.equal(totalBreaks, 1, '只有 p1 那局 -20 算突破，对手没成绩不影响')
  assert.equal(rows[0].playerId, 'p1')
  assert.deepEqual(buildPbStats().rows, [])
  assert.deepEqual(
    buildPbStats({ matches: [{ id: 'x' }], players: [{ id: 'p1', bestScore: -1 }] }).rows,
    [],
  )
})
