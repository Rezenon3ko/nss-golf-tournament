import { test } from 'node:test'
import assert from 'node:assert/strict'
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
const { useTournamentStore } = await import('../src/stores/tournament.js')

// ---------- 构造赛事数据的工具 ----------

const GROUP_PAIRINGS = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [0, 2],
    [1, 3],
  ],
  [
    [0, 3],
    [1, 2],
  ],
]

function player(id, groupId) {
  return { id, name: id.toUpperCase(), tier: 1, groupId, bestScore: 40 }
}

function emptySet() {
  return { a: null, b: null, sdWinner: null }
}

function played(stage, aId, bId, { sets, groupId = null, round = null, order = null, id }) {
  return {
    id,
    stage,
    groupId,
    round,
    order,
    playerAId: aId,
    playerBId: bId,
    sets,
    status: 'complete',
    forfeitBy: null,
    winnerId: aId,
    resultLinks: [],
    disconnect: null,
    createdAt: 1,
    updatedAt: 1,
    log: [],
  }
}

function winSets(aWins, stage, { winnerStrokes = -12, loserStrokes = -10, setsToWin = null } = {}) {
  const total = stage === 'group' ? 3 : 5
  const wins = setsToWin ?? (stage === 'group' ? 2 : 3)
  return Array.from({ length: total }, (_, i) => {
    if (i >= wins) return emptySet()
    return aWins
      ? { a: winnerStrokes, b: loserStrokes, sdWinner: null }
      : { a: loserStrokes, b: winnerStrokes, sdWinner: null }
  })
}

// 组内比赛：数组靠前的选手一律获胜（于是排名 = 数组顺序）
function completeGroup(groupId, ids, options = {}) {
  const out = []
  GROUP_PAIRINGS.forEach((pairs, roundIndex) => {
    pairs.forEach(([i, j], k) => {
      out.push(
        played('group', ids[i], ids[j], {
          id: `gm-${groupId}-${roundIndex + 1}-${k + 1}`,
          groupId,
          round: roundIndex + 1,
          sets: winSets(true, 'group', options),
        }),
      )
    })
  })
  return out
}

async function seedStore({ players, matches, tiebreakResolutions = {}, championId = null }) {
  backend.reset({
    row: {
      key: 'main',
      value: { players, matches, ddlRounds: [], tiebreakResolutions, championId },
      revision: 1,
    },
  })
  localStorage.clear()
  setActivePinia(createPinia())
  const store = useTournamentStore()
  await store.init()
  store.setCloudWriteEnabled(true)
  return store
}

// 重新录一次已完赛场次：用来触发淘汰赛同步
function touchGroupMatch(store, matchId) {
  return store.saveMatch(matchId, {
    sets: winSets(true, 'group'),
  })
}

// 创建淘汰赛场次（小组赛一完赛就会同步生成）
function prepareKnockout(store) {
  const groupMatch = store.matches.find((m) => m.stage === 'group')
  touchGroupMatch(store, groupMatch.id)
}

function ko(store, stage, order) {
  return store.matches.find((m) => m.stage === stage && m.order === order)
}

function saveKo(store, match, { aWins = true } = {}) {
  return store.saveMatch(match.id, { sets: winSets(aWins, match.stage) })
}

// ---------- 净胜局 / 净胜杆 ----------

test('决胜局之后误填的局不影响净胜局与净胜杆', async () => {
  const players = ['p1', 'p2', 'p3', 'p4'].map((id) => player(id, 'A'))
  const store = await seedStore({
    players,
    matches: [
      played('group', 'p1', 'p2', {
        id: 'gm-1',
        groupId: 'A',
        round: 1,
        // p1 先 2:0，第 3 局是误填（若计入，净胜杆会从 -4 变成 -33）
        sets: [
          { a: -14, b: -12, sdWinner: null },
          { a: -10, b: -8, sdWinner: null },
          { a: -30, b: -1, sdWinner: null },
        ],
      }),
    ],
  })

  const row = store.getStandings('A').find((r) => r.playerId === 'p1')
  assert.equal(row.points, 2)
  assert.equal(row.setsWon, 2)
  assert.equal(row.setsLost, 0)
  assert.equal(row.strokeDiff, -4)
  assert.deepEqual(store.matchScore(store.matches[0]), { a: 2, b: 0 })
})

// ---------- 排名与并列 ----------

test('排名按 积分 → 相互战绩 → 净胜局 → 净胜杆 依次判定', async () => {
  const players = ['p1', 'p2', 'p3', 'p4'].map((id) => player(id, 'A'))
  // p1 与 p2 相互双方负（积分、净胜局相同、h2h 都为 0），
  // 但对 p3/p4 的净胜杆不同：p1 赢得更狠（-20 每局）→ p1 应排在 p2 前
  const vsBottom = (id, aId, strokes) => [
    played('group', aId, id, {
      id: `vs-${aId}-${id}`,
      groupId: 'A',
      round: 2,
      sets: [
        { a: strokes, b: -10, sdWinner: null },
        { a: strokes, b: -10, sdWinner: null },
        emptySet(),
      ],
    }),
  ]
  const matches = [
    {
      id: 'gm-both',
      stage: 'group',
      groupId: 'A',
      round: 1,
      playerAId: 'p1',
      playerBId: 'p2',
      sets: [emptySet(), emptySet(), emptySet()],
      status: 'forfeit',
      forfeitBy: 'both',
      winnerId: null,
      resultLinks: [],
      disconnect: null,
      createdAt: 1,
      updatedAt: 1,
      log: [],
    },
    ...vsBottom('p3', 'p1', -20),
    ...vsBottom('p4', 'p1', -20),
    ...vsBottom('p3', 'p2', -12),
    ...vsBottom('p4', 'p2', -12),
    // p3 与 p4 的战绩也做成完全相同，便于单独验证并列
    played('group', 'p3', 'p4', {
      id: 'gm-3-4',
      groupId: 'A',
      round: 3,
      sets: [{ a: -12, b: -10, sdWinner: null }, { a: -12, b: -10, sdWinner: null }, emptySet()],
    }),
  ]

  const store = await seedStore({ players, matches })
  const rows = store.getStandings('A')

  assert.deepEqual(
    rows.map((r) => r.playerId),
    ['p1', 'p2', 'p3', 'p4'],
  )
  assert.equal(rows[0].points, 4)
  assert.equal(rows[1].points, 4)
  assert.equal(rows[0].setDiff, 4)
  assert.equal(rows[1].setDiff, 4)
  assert.equal(rows[0].strokeDiff, -40)
  assert.equal(rows[1].strokeDiff, -8)
  // 净胜杆更小者（p1）排在前面
  assert.ok(rows[0].strokeDiff < rows[1].strokeDiff)
})

test('全维度并列时标记待抽签，抽签后按抽签顺序且不再标记', async () => {
  const players = ['p1', 'p2', 'p3', 'p4'].map((id) => player(id, 'A'))
  const matches = completeGroup('A', ['p1', 'p2', 'p3', 'p4'])
  // 把 p3 vs p4 改成双方负：两人战绩完全相同（积分/净胜局/净胜杆/h2h 都为 0）
  const bothLoss = matches.find((m) => m.playerAId === 'p3' && m.playerBId === 'p4')
  bothLoss.sets = [emptySet(), emptySet(), emptySet()]
  bothLoss.status = 'forfeit'
  bothLoss.forfeitBy = 'both'
  bothLoss.winnerId = null
  // 让两人对 p1/p2 的杆数也一致
  for (const m of matches) {
    if (m.playerAId === 'p1' && m.playerBId === 'p4') m.sets = winSets(true, 'group')
    if (m.playerAId === 'p1' && m.playerBId === 'p3') m.sets = winSets(true, 'group')
    if (m.playerAId === 'p2' && m.playerBId === 'p4') m.sets = winSets(true, 'group')
    if (m.playerAId === 'p2' && m.playerBId === 'p3') m.sets = winSets(true, 'group')
  }

  const store = await seedStore({ players, matches })
  const before = store.getStandings('A')

  assert.deepEqual(before.map((r) => r.playerId).slice(2), ['p3', 'p4'])
  assert.equal(before[2].needsDraw, true)
  assert.equal(before[3].needsDraw, true)

  store.resolveTiebreak('A')
  const after = store.getStandings('A')

  assert.deepEqual(after.map((r) => r.playerId).slice(2), store.tiebreakResolutions.A)
  assert.equal(
    after.some((r) => r.needsDraw),
    false,
  )
})

// ---------- 淘汰赛 ----------

test('小组没全部结束前，八强只显示预计对位', async () => {
  const players = [
    ...['p1', 'p2', 'p3', 'p4'].map((id) => player(id, 'A')),
    ...['q1', 'q2', 'q3', 'q4'].map((id) => player(id, 'B')),
    ...['r1', 'r2', 'r3', 'r4'].map((id) => player(id, 'C')),
  ]
  const store = await seedStore({
    players,
    matches: [
      ...completeGroup('A', ['p1', 'p2', 'p3', 'p4']),
      ...completeGroup('B', ['q1', 'q2', 'q3', 'q4']),
    ],
  })
  prepareKnockout(store)

  const seeds = store.knockoutMatches
  const qf1 = seeds.find((n) => n.stage === 'qf' && n.order === 1)
  const qf2 = seeds.find((n) => n.stage === 'qf' && n.order === 2)
  const qf3 = seeds.find((n) => n.stage === 'qf' && n.order === 3)

  assert.equal(qf1.playerAId, 'p1', 'A 组第 1')
  assert.equal(qf1.playerBId, 'q2', 'B 组第 2')
  assert.equal(qf1.status, 'pending')
  assert.equal(qf3.playerAId, 'p2', 'A 组第 2')
  assert.equal(qf3.playerBId, 'q1', 'B 组第 1')
  assert.equal(qf2.status, 'locked', 'C/D 组未结束 → 只显示预计对位')
  assert.equal(qf2.playerAId, null)
})

test('淘汰赛逐轮晋级并决出冠军与亚军', async () => {
  const ids = ['A', 'B', 'C', 'D']
  const players = ids.flatMap((g) => [1, 2, 3, 4].map((n) => player(`${g.toLowerCase()}${n}`, g)))
  const matches = ids.flatMap((g) => {
    const group = g.toLowerCase()
    return completeGroup(g, [`${group}1`, `${group}2`, `${group}3`, `${group}4`])
  })
  const store = await seedStore({ players, matches })
  prepareKnockout(store)

  // 四组全部结束后，八强四个对阵都应有真实选手
  assert.equal(
    store.knockoutMatches.filter((n) => n.stage === 'qf' && n.playerAId && n.playerBId).length,
    4,
  )

  const qf1 = ko(store, 'qf', 1)
  saveKo(store, qf1)
  assert.ok(ko(store, 'sf', 1).playerAId, '八强胜者自动进入半决赛')

  saveKo(store, ko(store, 'qf', 2))
  saveKo(store, ko(store, 'qf', 3))
  saveKo(store, ko(store, 'qf', 4))

  const sf1 = ko(store, 'sf', 1)
  const sf2 = ko(store, 'sf', 2)
  assert.equal(sf1.playerAId, qf1.playerAId)
  assert.equal(sf1.playerBId, ko(store, 'qf', 2).playerAId)
  saveKo(store, sf1)
  saveKo(store, sf2)

  const final = ko(store, 'final', 1)
  assert.equal(final.playerAId, sf1.playerAId)
  assert.equal(final.playerBId, sf2.playerAId)

  saveKo(store, final)
  assert.equal(store.championId, final.playerAId)
  assert.equal(store.runnerUpId, final.playerBId)
  assert.equal(store.stage, 'finished')
})

test('双方负让对手直接晋级下一轮（本场轮空）', async () => {
  const ids = ['A', 'B', 'C', 'D']
  const players = ids.flatMap((g) => [1, 2, 3, 4].map((n) => player(`${g.toLowerCase()}${n}`, g)))
  const matches = ids.flatMap((g) => {
    const group = g.toLowerCase()
    return completeGroup(g, [`${group}1`, `${group}2`, `${group}3`, `${group}4`])
  })
  const store = await seedStore({ players, matches })
  prepareKnockout(store)

  const qf1 = ko(store, 'qf', 1)
  const qf2 = ko(store, 'qf', 2)
  // 先打完另外一场八强，双方负的对手才有确定的晋级人选
  saveKo(store, qf2)
  store.forfeitMatch(qf1.id, 'both')

  const sf1 = ko(store, 'sf', 1)
  assert.equal(sf1.status, 'walkover')
  assert.equal(sf1.playerAId, qf2.playerAId, '对方直接晋级')
  assert.equal(sf1.playerBId, null)

  // 另一半区正常打完，决赛仍是正常的两人对阵
  saveKo(store, ko(store, 'qf', 3))
  saveKo(store, ko(store, 'qf', 4))
  saveKo(store, ko(store, 'sf', 2))

  const final = ko(store, 'final', 1)
  assert.equal(final.status, 'pending')
  assert.equal(final.playerAId, qf2.playerAId)
  assert.equal(final.playerBId, ko(store, 'sf', 2).playerAId)
})

test('整个半区作废时，另一个半区胜者直接夺冠（含递补亚军）', async () => {
  const ids = ['A', 'B', 'C', 'D']
  const players = ids.flatMap((g) => [1, 2, 3, 4].map((n) => player(`${g.toLowerCase()}${n}`, g)))
  const matches = ids.flatMap((g) => {
    const group = g.toLowerCase()
    return completeGroup(g, [`${group}1`, `${group}2`, `${group}3`, `${group}4`])
  })
  const store = await seedStore({ players, matches })
  prepareKnockout(store)

  // 上半区两场八强都双方负 → 半决赛取消 → 上半区整体作废
  store.forfeitMatch(ko(store, 'qf', 1).id, 'both')
  store.forfeitMatch(ko(store, 'qf', 2).id, 'both')
  assert.equal(ko(store, 'sf', 1).status, 'walkover')
  assert.equal(ko(store, 'sf', 1).playerAId, null)

  // 下半区正常打完
  saveKo(store, ko(store, 'qf', 3))
  saveKo(store, ko(store, 'qf', 4))
  const sf2 = ko(store, 'sf', 2)
  saveKo(store, sf2)

  const final = ko(store, 'final', 1)
  assert.equal(final.status, 'walkover')
  assert.equal(final.walkover, '对手半区作废，直接夺冠')
  assert.equal(store.championId, sf2.playerAId)
  assert.equal(store.runnerUpId, sf2.playerBId, '半决赛败者递补亚军')
})
