import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { TOURNAMENT_STORAGE_KEY, USE_SUPABASE } from '@/config'
import { supabase } from '@/lib/supabase'

const GROUPS = ['A', 'B', 'C', 'D']
const TIERS = [1, 2, 3, 4]

const STAGE_LABELS = {
  group: '小组赛',
  qf: '八强',
  sf: '半决赛',
  final: '决赛',
}

const STATUS_LABELS = {
  pending: '未开始',
  complete: '已完赛',
  forfeit: '判负',
  overdue: '逾期',
  locked: '预计',
  walkover: '直接晋级',
}

function now() {
  return Date.now()
}

function toNum(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  // 相对标准杆允许负数（-14 表示低于标准杆 14 杆）
  return Number.isFinite(n) ? n : null
}

function uid(prefix) {
  return `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// 加密级随机整数 [0, max)：拒绝采样消除模偏差
function secureRandomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let value
  do {
    globalThis.crypto.getRandomValues(buf)
    value = buf[0]
  } while (value >= limit)
  return value % max
}

function shuffle(list) {
  const arr = [...list]
  const hasCrypto =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  if (!hasCrypto) {
    // 极老环境回退到 Math.random（实际几乎不会走到）
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = secureRandomInt(i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function emptySets(count) {
  return Array.from({ length: count }, () => ({ a: null, b: null, sdWinner: null }))
}

// ---------- 种子数据 ----------

const SEED_PLAYERS = [
  { id: 'p1', name: 'summer', bestScore: 36 },
  { id: 'p2', name: 'smallwater', bestScore: 37 },
  { id: 'p3', name: 'MidOne', bestScore: 38 },
  { id: 'p4', name: 'zee', bestScore: 39 },
  { id: 'p5', name: 'xxigua', bestScore: 41 },
  { id: 'p6', name: 'Showhand', bestScore: 42 },
  { id: 'p7', name: 'lglrwjx', bestScore: 42 },
  { id: 'p8', name: 'CG', bestScore: 43 },
  { id: 'p9', name: 'Duncan1314', bestScore: 45 },
  { id: 'p10', name: 'n3ko', bestScore: 45 },
  { id: 'p11', name: 'gakki', bestScore: 46 },
  { id: 'p12', name: 'SunnyMudTo', bestScore: 46 },
  { id: 'p13', name: 'shinamikan', bestScore: 49 },
  { id: 'p14', name: 'bx-th', bestScore: 50 },
  { id: 'p15', name: 'gcy', bestScore: 51 },
  { id: 'p16', name: 'lzy', bestScore: 52 },
]

const SEED_TIERS = {
  p1: 1, p2: 1, p3: 1, p4: 1,
  p5: 2, p6: 2, p7: 2, p8: 2,
  p9: 3, p10: 3, p11: 3, p12: 3,
  p13: 4, p14: 4, p15: 4, p16: 4,
}

function buildSeedDdl() {
  const mk = (key, label, stage, round, ddl) => ({ key, label, stage, round, ddl })
  return [
    mk('group1', '小组赛第1轮', 'group', 1, '2026-08-30T23:59'),
    mk('group2', '小组赛第2轮', 'group', 2, '2026-09-06T23:59'),
    mk('group3', '小组赛第3轮', 'group', 3, '2026-09-13T23:59'),
    mk('qf', '八强', 'qf', null, '2026-09-20T23:59'),
    mk('sf', '半决赛', 'sf', null, '2026-09-27T23:59'),
    mk('final', '决赛', 'final', null, '2026-10-04T23:59'),
  ]
}

function buildSeed() {
  const players = SEED_PLAYERS.map((p) => ({
    ...p,
    tier: SEED_TIERS[p.id],
    groupId: null,
  }))
  return {
    players,
    draft: null,
    matches: [],
    ddlRounds: buildSeedDdl(),
    tiebreakResolutions: {},
    evidence: [],
    logs: [
      { id: 'lg-1', time: now(), by: '系统', message: '初始状态：等待抽签分组' },
    ],
    championId: null,
    drawHistory: [],
  }
}

// ---------- 单场比赛结果 ----------

function setWinnerId(set, playerAId, playerBId) {
  if (set.a == null || set.b == null) return null
  if (set.a < set.b) return playerAId
  if (set.b < set.a) return playerBId
  return set.sdWinner || null
}

function countSetWins(match) {
  const wins = { A: 0, B: 0 }
  for (const set of match.sets) {
    const w = setWinnerId(set, match.playerAId, match.playerBId)
    if (w === match.playerAId) wins.A += 1
    else if (w === match.playerBId) wins.B += 1
  }
  return wins
}

function loserOf(match) {
  if (!match) return null
  const w = matchWinner(match)
  if (!w) return null
  return w === match.playerAId ? match.playerBId : match.playerAId
}

function matchWinner(match) {
  if (match.status === 'forfeit') {
    if (match.forfeitBy === 'A') return match.playerBId
    if (match.forfeitBy === 'B') return match.playerAId
    return null
  }
  if (match.status !== 'complete') return null
  const wins = countSetWins(match)
  const need = match.stage === 'group' ? 2 : 3
  if (wins.A >= need) return match.playerAId
  if (wins.B >= need) return match.playerBId
  return null
}

function matchScore(match) {
  const wins = countSetWins(match)
  return { a: wins.A, b: wins.B }
}

function resultForPlayer(match, playerId) {
  const base = {
    played: true,
    outcome: null,
    setsWon: 0,
    setsLost: 0,
    strokesFor: 0,
    strokesAgainst: 0,
    points: 0,
  }
  const isA = match.playerAId === playerId
  const opponentId = isA ? match.playerBId : match.playerAId

  if (match.status === 'forfeit') {
    if (match.forfeitBy === 'both') {
      base.outcome = 'bothLoss'
      base.points = 0
      return base
    }
    const winnerId = matchWinner(match)
    base.outcome = winnerId === playerId ? 'win' : 'loss'
    base.points = base.outcome === 'win' ? 2 : 1
    return base
  }

  if (match.status !== 'complete') {
    base.played = false
    return base
  }

  for (const set of match.sets) {
    const w = setWinnerId(set, match.playerAId, match.playerBId)
    if (w === playerId) base.setsWon += 1
    else if (w === opponentId) base.setsLost += 1
    const own = isA ? set.a : set.b
    const opp = isA ? set.b : set.a
    if (own != null) base.strokesFor += own
    if (opp != null) base.strokesAgainst += opp
  }

  const winnerId = matchWinner(match)
  base.outcome = winnerId === playerId ? 'win' : 'loss'
  base.points = base.outcome === 'win' ? 2 : 1
  return base
}

// ---------- 小组积分与排名 ----------

function buildStandingsRow(player, matches) {
  const row = {
    playerId: player.id,
    name: player.name,
    tier: player.tier,
    groupId: player.groupId,
    played: 0,
    wins: 0,
    losses: 0,
    points: 0,
    setsWon: 0,
    setsLost: 0,
    strokesFor: 0,
    strokesAgainst: 0,
    h2hWins: 0,
    needsDraw: false,
    rank: 0,
  }

  for (const match of matches) {
    if (!match.playerAId || !match.playerBId) continue
    const involves = match.playerAId === player.id || match.playerBId === player.id
    if (!involves) continue
    const res = resultForPlayer(match, player.id)
    if (!res.played) continue
    row.played += 1
    row.points += res.points
    row.setsWon += res.setsWon
    row.setsLost += res.setsLost
    row.strokesFor += res.strokesFor
    row.strokesAgainst += res.strokesAgainst
    if (res.outcome === 'win') row.wins += 1
    if (res.outcome === 'loss') row.losses += 1
  }

  row.setDiff = row.setsWon - row.setsLost
  // 净胜杆 = 自己总杆 - 对手总杆（高尔夫杆数越低越好，领先方为负数）
  row.strokeDiff = row.strokesFor - row.strokesAgainst
  return row
}

function h2hWinsAmong(rows, matches) {
  const ids = new Set(rows.map((r) => r.playerId))
  const wins = new Map(rows.map((r) => [r.playerId, 0]))
  for (const match of matches) {
    if (match.status === 'pending') continue
    if (!ids.has(match.playerAId) || !ids.has(match.playerBId)) continue
    const winnerId = matchWinner(match)
    if (winnerId && wins.has(winnerId)) {
      wins.set(winnerId, wins.get(winnerId) + 1)
    }
  }
  for (const row of rows) {
    row.h2hWins = wins.get(row.playerId) || 0
  }
}

function sortTieGroup(tie, matches, resolution) {
  const orderMap = new Map((resolution || []).map((id, idx) => [id, idx]))
  h2hWinsAmong(tie, matches)
  tie.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points
    if (y.h2hWins !== x.h2hWins) return y.h2hWins - x.h2hWins
    if (y.setDiff !== x.setDiff) return y.setDiff - x.setDiff
    // 净胜杆越小（越负）越好，故升序排列
    if (x.strokeDiff !== y.strokeDiff) return x.strokeDiff - y.strokeDiff
    const ox = orderMap.has(x.playerId) ? orderMap.get(x.playerId) : Infinity
    const oy = orderMap.has(y.playerId) ? orderMap.get(y.playerId) : Infinity
    return ox - oy
  })
  return tie
}

function getStandingsFor(state, groupId) {
  const groupPlayers = state.players
    .filter((p) => p.groupId === groupId)
    .sort((a, b) => a.id.localeCompare(b.id))
  const matches = state.matches.filter(
    (m) => m.stage === 'group' && m.groupId === groupId && m.playerAId && m.playerBId,
  )
  let rows = groupPlayers.map((p) => buildStandingsRow(p, matches))
  rows.sort((a, b) => b.points - a.points)

  const resolution = state.tiebreakResolutions[groupId] || []
  const groupComplete = matches.length > 0 && matches.every((m) => m.status !== 'pending')

  // 按积分分段，段内应用 tiebreaker
  const sorted = []
  let i = 0
  while (i < rows.length) {
    let j = i
    while (j + 1 < rows.length && rows[j + 1].points === rows[i].points) j += 1
    const tie = sortTieGroup(rows.slice(i, j + 1), matches, resolution)
    sorted.push(...tie)
    i = j + 1
  }
  rows = sorted

  // 全维度仍并列 -> 待抽签（小组赛结束后才判定；已抽签解决的并列不再标记）
  if (groupComplete) {
    const orderMap = new Map((resolution || []).map((id, idx) => [id, idx]))
    for (let k = 0; k < rows.length; k += 1) {
      const row = rows[k]
      const same = (a, b) =>
        !!a && !!b
        && a.points === b.points
        && a.h2hWins === b.h2hWins
        && a.setDiff === b.setDiff
        && a.strokeDiff === b.strokeDiff
      let s = k
      while (s > 0 && same(rows[s - 1], row)) s -= 1
      let e = k
      while (e + 1 < rows.length && same(rows[e + 1], row)) e += 1
      const cluster = rows.slice(s, e + 1)
      // 该并列簇内所有选手都已抽签确定顺序，视为已解决
      const allResolved = cluster.every((r) => orderMap.has(r.playerId))
      row.needsDraw = cluster.length > 1 && !allResolved
    }
  }

  rows.forEach((row, index) => {
    row.rank = index + 1
  })
  return rows
}

function groupStageCompleteFor(state, groupId) {
  const matches = state.matches.filter(
    (m) => m.stage === 'group' && m.groupId === groupId && m.playerAId && m.playerBId,
  )
  return matches.length > 0 && matches.every((m) => m.status !== 'pending')
}

// ---------- 淘汰赛 ----------

function knockoutSeedMatches(state) {
  const standings = {}
  for (const g of GROUPS) {
    standings[g] = getStandingsFor(state, g)
  }
  // 该组全部赛完、且无待抽签时，才能确定晋级选手；否则保持"预计对位"
  const idAt = (g, idx) => {
    if (!groupStageCompleteFor(state, g)) return null
    const row = standings[g][idx]
    if (!row || row.needsDraw) return null
    return row.playerId
  }
  return [
    { stage: 'qf', order: 1, label: '八强 1', a: idAt('A', 0), b: idAt('B', 1), expectedA: 'A组第1名', expectedB: 'B组第2名' },
    { stage: 'qf', order: 2, label: '八强 2', a: idAt('C', 0), b: idAt('D', 1), expectedA: 'C组第1名', expectedB: 'D组第2名' },
    { stage: 'qf', order: 3, label: '八强 3', a: idAt('A', 1), b: idAt('B', 0), expectedA: 'A组第2名', expectedB: 'B组第1名' },
    { stage: 'qf', order: 4, label: '八强 4', a: idAt('C', 1), b: idAt('D', 0), expectedA: 'C组第2名', expectedB: 'D组第1名' },
    { stage: 'sf', order: 1, label: '半决赛 1', a: null, b: null, expectedA: '八强1胜者', expectedB: '八强2胜者' },
    { stage: 'sf', order: 2, label: '半决赛 2', a: null, b: null, expectedA: '八强3胜者', expectedB: '八强4胜者' },
    { stage: 'final', order: 1, label: '决赛', a: null, b: null, expectedA: '上半区胜者', expectedB: '下半区胜者' },
  ]
}

function createKnockoutMatch(state, seed, exists) {
  if (exists) return exists
  const match = {
    id: uid('ko'),
    stage: seed.stage,
    groupId: null,
    round: null,
    order: seed.order,
    playerAId: seed.a,
    playerBId: seed.b,
    sets: emptySets(5),
    status: 'pending',
    forfeitBy: null,
    winnerId: null,
    resultLinks: [],
    disconnect: null,
    createdAt: now(),
    updatedAt: now(),
    log: [],
  }
  state.matches.push(match)
  return match
}

function syncKnockout(state, persistFn) {
  const seeds = knockoutSeedMatches(state)
  const qfWinners = {}
  const existing = (stage, order) =>
    state.matches.find((m) => m.stage === stage && m.order === order)

  for (const seed of seeds) {
    const match = createKnockoutMatch(state, seed, existing(seed.stage, seed.order))
    // 已完赛或已判负的场次保留选手，不再用种子重置（否则判负的决赛/半决赛会被清空）
    if (match.status !== 'complete' && match.status !== 'forfeit') {
      match.playerAId = seed.a
      match.playerBId = seed.b
    }
    if (match.status === 'complete') {
      const w = matchWinner(match)
      qfWinners[seed.order] = w
    }
  }

  // 半决赛/决赛选手由上一轮胜者推导（仅当未完赛时更新）
  const qfById = (order) => existing('qf', order)
  const sfSeeds = [
    { stage: 'sf', order: 1, label: '半决赛 1' },
    { stage: 'sf', order: 2, label: '半决赛 2' },
  ]
  const sfPairs = [
    [qfById(1), qfById(2)],
    [qfById(3), qfById(4)],
  ]
  // 双方负处理：仅当某场淘汰赛真正"双方负"（forfeit both、无胜者）时，配对侧胜者直接晋级下一轮
  const isBothForfeit = (m) => m && m.status === 'forfeit' && m.forfeitBy === 'both'
  const sfWalkover = {}
  for (const [idx, seed] of sfSeeds.entries()) {
    const match = existing('sf', seed.order)
    if (!match || match.status === 'complete' || match.status === 'forfeit') continue
    const [q1, q2] = sfPairs[idx]
    const a = q1 && matchWinner(q1)
    const b = q2 && matchWinner(q2)
    const aVoid = isBothForfeit(q1)
    const bVoid = isBothForfeit(q2)
    if (a && b) {
      match.playerAId = a
      match.playerBId = b
      match.walkover = null
      if (match.status === 'walkover') match.status = 'pending'
    } else if ((a && bVoid) || (b && aVoid)) {
      // 一侧双方负、另一侧已出胜者：胜者直接晋级决赛（本场半决赛轮空）
      const w = a || b
      sfWalkover[seed.order] = w
      match.playerAId = w
      match.playerBId = null
      match.walkover = '对手双方负，直接晋级决赛'
      match.status = 'walkover'
    } else if (aVoid && bVoid) {
      match.playerAId = null
      match.playerBId = null
      match.walkover = '双方负，本场取消'
      match.status = 'walkover'
    } else {
      // 至少一侧尚未决出（待赛）：保持待定，不轮空、不晋级
      match.playerAId = a || null
      match.playerBId = b || null
      match.walkover = null
      if (match.status === 'walkover') match.status = 'pending'
    }
  }

  const final = existing('final', 1)
  if (final && (final.status === 'pending' || final.status === 'walkover')) {
    const sf1 = existing('sf', 1)
    const sf2 = existing('sf', 2)
    const f1 = sfWalkover[1] || (sf1 && matchWinner(sf1))
    const f2 = sfWalkover[2] || (sf2 && matchWinner(sf2))
    // 半区"整体作废"：半决赛本身双方负，或半决赛被取消（该半区八强全部双方负）
    const sf1Void =
      isBothForfeit(sf1) || (sf1 && sf1.status === 'walkover' && !sfWalkover[1])
    const sf2Void =
      isBothForfeit(sf2) || (sf2 && sf2.status === 'walkover' && !sfWalkover[2])
    final.playerAId = f1 || null
    final.playerBId = f2 || null
    if (f1 && f2) {
      final.walkover = null
      final.runnerUpId = null
      if (final.status === 'walkover') final.status = 'pending'
    } else if (f1 && sf2Void) {
      // 下半区整体作废：上半区决赛选手直接夺冠；若其半决赛真实完赛，败者递补亚军
      const champ = f1
      const runnerUp =
        !sfWalkover[1] && sf1 && matchWinner(sf1) === champ ? loserOf(sf1) : null
      final.playerAId = champ
      final.playerBId = null
      final.walkover = '对手半区作废，直接夺冠'
      final.runnerUpId = runnerUp
      final.status = 'walkover'
      state.championId.value = champ
    } else if (f2 && sf1Void) {
      // 上半区整体作废：下半区决赛选手直接夺冠；若其半决赛真实完赛，败者递补亚军
      const champ = f2
      const runnerUp =
        !sfWalkover[2] && sf2 && matchWinner(sf2) === champ ? loserOf(sf2) : null
      final.playerAId = champ
      final.playerBId = null
      final.walkover = '对手半区作废，直接夺冠'
      final.runnerUpId = runnerUp
      final.status = 'walkover'
      state.championId.value = champ
    } else if (sf1Void && sf2Void) {
      final.walkover = '双方半区作废，决赛取消'
      final.runnerUpId = null
      final.status = 'walkover'
      state.championId.value = null
    } else {
      // 至少一侧尚未决出：决赛保持待定，不提前确定冠军
      final.walkover = null
      final.runnerUpId = null
      if (final.status === 'walkover') final.status = 'pending'
      state.championId.value = null
    }
  }

  if (final && (final.status === 'complete' || final.status === 'forfeit')) {
    state.championId.value = matchWinner(final)
    final.runnerUpId = null
  }

  persistFn()
}

// ---------- store ----------

export const useTournamentStore = defineStore('tournament', () => {
  const players = ref([])
  const draft = ref(null)
  const matches = ref([])
  const ddlRounds = ref([])
  const tiebreakResolutions = ref({})
  const evidence = ref([])
  const logs = ref([])
  const championId = ref(null)
  const drawHistory = ref([])
  const ready = ref(false)

  // 决赛结束后：决赛败者为亚军
  const runnerUpId = computed(() => {
    const final = matches.value.find((m) => m.stage === 'final')
    if (!final) return null
    // 半区作废时的递补亚军
    if (final.runnerUpId) return final.runnerUpId
    if ((final.status !== 'complete' && final.status !== 'forfeit') || !final.winnerId) {
      return null
    }
    return final.winnerId === final.playerAId ? final.playerBId : final.playerAId
  })
  const supabaseMode = ref(false)

  function persistLocal() {
    localStorage.setItem(
      TOURNAMENT_STORAGE_KEY,
      JSON.stringify({
        players: players.value,
        draft: draft.value,
        matches: matches.value,
        ddlRounds: ddlRounds.value,
        tiebreakResolutions: tiebreakResolutions.value,
        evidence: evidence.value,
        logs: logs.value,
        championId: championId.value,
        drawHistory: drawHistory.value,
      }),
    )
  }

  function persistToSupabase() {
    if (!supabase) return
    const snapshot = {
      players: players.value,
      draft: draft.value,
      matches: matches.value,
      ddlRounds: ddlRounds.value,
      tiebreakResolutions: tiebreakResolutions.value,
      evidence: evidence.value,
      logs: logs.value,
      championId: championId.value,
      drawHistory: drawHistory.value,
    }
    supabase
      .from('tournament_state')
      .upsert({ key: 'main', value: snapshot }, { onConflict: 'key' })
      .then(({ error }) => {
        if (error) console.error('Supabase 写入失败：', error.message)
      })
  }

  function persist() {
    if (supabaseMode.value) {
      persistToSupabase()
      return
    }
    persistLocal()
  }

  // 主办方登录后调用：把本地/种子数据同步到云端（携带登录态，RLS 才放行）
  function ensureCloudSync() {
    if (supabaseMode.value) {
      persistToSupabase()
    }
  }

  function stateView() {
    return {
      players: players.value,
      matches: matches.value,
      tiebreakResolutions: tiebreakResolutions.value,
      championId: championId,
    }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(TOURNAMENT_STORAGE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.players)) return false
      players.value = data.players
      draft.value = data.draft || null
      matches.value = data.matches || []
      ddlRounds.value = data.ddlRounds || []
      tiebreakResolutions.value = data.tiebreakResolutions || {}
      evidence.value = data.evidence || []
      logs.value = data.logs || []
      championId.value = data.championId || null
      drawHistory.value = data.drawHistory || []
      return true
    } catch {
      return false
    }
  }

  async function loadFromSupabase() {
    if (!supabase) return 'error'
    const { data, error } = await supabase
      .from('tournament_state')
      .select('value')
      .eq('key', 'main')
      .maybeSingle()
    if (error) {
      console.warn('Supabase 读取失败：', error.message)
      return 'error'
    }
    if (!data?.value) return 'empty'
    const v = data.value
    players.value = v.players || []
    draft.value = v.draft || null
    matches.value = v.matches || []
    ddlRounds.value = v.ddlRounds || []
    tiebreakResolutions.value = v.tiebreakResolutions || {}
    evidence.value = v.evidence || []
    logs.value = v.logs || []
    championId.value = v.championId || null
    drawHistory.value = v.drawHistory || []
    supabaseMode.value = true
    return 'ok'
  }

  function seedState() {
    const seed = buildSeed()
    players.value = seed.players
    draft.value = seed.draft
    matches.value = seed.matches
    ddlRounds.value = seed.ddlRounds
    tiebreakResolutions.value = seed.tiebreakResolutions
    evidence.value = seed.evidence
    logs.value = seed.logs
    championId.value = seed.championId
    drawHistory.value = seed.drawHistory || []
  }

  async function init() {
    if (USE_SUPABASE && supabase) {
      const result = await loadFromSupabase()
      if (result === 'ok') {
        ready.value = true
        return
      }
      if (result === 'empty') {
        // 云端建好表但还没有数据：先保留本地/种子数据，
        // 云端的首次写入等主办方登录后由 ensureCloudSync 完成（游客无写权限）
        if (!loadLocal()) {
          seedState()
        }
        supabaseMode.value = true
        ready.value = true
        return
      }
      console.warn('Supabase 暂不可用（请先在 SQL Editor 执行 supabase/schema.sql），回退本地数据')
    }
    if (!loadLocal()) {
      seedState()
      persistLocal()
    }
    ready.value = true
  }

  function addLog(message, by = '主办方') {
    logs.value.unshift({ id: uid('lg'), time: now(), by, message })
  }

  // ---------- 选手与分组 ----------

  function addPlayer(payload) {
    const player = {
      id: uid('p'),
      name: String(payload.name || '').trim(),
      avatar: payload.avatar || null,
      bestScore: toNum(payload.bestScore) || null,
      tier: Number(payload.tier) || 4,
      groupId: null,
    }
    players.value.push(player)
    addLog(`添加选手 ${player.name}`)
    persist()
    return player
  }

  function updatePlayer(id, payload) {
    const player = players.value.find((p) => p.id === id)
    if (!player) return
    const oldName = player.name
    if (payload.name !== undefined) player.name = String(payload.name).trim()
    if (payload.avatar !== undefined) player.avatar = payload.avatar || null
    if (payload.bestScore !== undefined) player.bestScore = toNum(payload.bestScore)
    if (payload.tier !== undefined) player.tier = Number(payload.tier)
    addLog(`编辑选手 ${oldName}`)
    persist()
  }

  function removePlayer(id) {
    const hasMatches = matches.value.some(
      (m) => m.playerAId === id || m.playerBId === id,
    )
    if (hasMatches) return false
    const player = players.value.find((p) => p.id === id)
    players.value = players.value.filter((p) => p.id !== id)
    if (player) addLog(`删除选手 ${player.name}`)
    persist()
    return true
  }

  function drawGroups() {
    const byTier = {}
    for (const tier of TIERS) {
      byTier[tier] = shuffle(players.value.filter((p) => p.tier === tier).map((p) => p.id))
    }
    const next = {}
    GROUPS.forEach((g, gi) => {
      next[g] = TIERS.map((tier) => byTier[tier][gi]).filter(Boolean)
    })
    draft.value = next
    const record = {
      id: uid('draw'),
      time: now(),
      by: '主办方',
      tiers: byTier,
      groups: { ...next },
    }
    drawHistory.value.unshift(record)
    addLog(`执行随机抽签（加密随机 crypto.getRandomValues），记录 ${record.id}`)
    persist()
  }

  function constraintValid(d = draft.value) {
    if (!d) return false
    const used = new Set()
    return GROUPS.every((g) => {
      const ids = (d[g] || []).filter(Boolean)
      if (ids.length !== 4) return false
      const tiers = new Set(ids.map((id) => players.value.find((p) => p.id === id)?.tier))
      if (tiers.size !== 4 || !TIERS.every((t) => tiers.has(t))) return false
      for (const id of ids) {
        if (used.has(id)) return false
        used.add(id)
      }
      return true
    })
  }

  // 手动分组：为某组的某个档位槽位选择/清空选手（自动保证跨组唯一）
  function setDraftGroup(groupId, tierIndex, playerId) {
    if (!draft.value) {
      draft.value = { A: [], B: [], C: [], D: [] }
    }
    for (const g of GROUPS) {
      const arr = draft.value[g] || []
      const idx = arr.indexOf(playerId)
      if (idx !== -1 && g !== groupId) {
        arr[idx] = null
      }
    }
    const group = draft.value[groupId] || []
    group[tierIndex] = playerId || null
    draft.value[groupId] = group
    persist()
  }

  function clearDraft() {
    draft.value = null
    addLog('清空手动分组选择')
    persist()
  }

  function publishGroups() {
    if (!constraintValid()) return false
    for (const [g, ids] of Object.entries(draft.value)) {
      for (const id of ids.filter(Boolean)) {
        const player = players.value.find((p) => p.id === id)
        if (player) player.groupId = g
      }
    }
    // 生成小组赛赛程
    const groupPlayers = {}
    for (const g of GROUPS) {
      groupPlayers[g] = players.value.filter((p) => p.groupId === g)
    }
    const pairings = [
      [1, 2, 3, 4],
      [1, 3, 2, 4],
      [1, 4, 2, 3],
    ]
    matches.value = []
    for (const g of GROUPS) {
      const gp = groupPlayers[g]
      pairings.forEach(([a1, a2, b1, b2], round) => {
        matches.value.push(
          makeGroupMatch(`gm-${g}-${round + 1}-1`, g, round + 1, gp[a1 - 1].id, gp[a2 - 1].id),
          makeGroupMatch(`gm-${g}-${round + 1}-2`, g, round + 1, gp[b1 - 1].id, gp[b2 - 1].id),
        )
      })
    }
    tiebreakResolutions.value = {}
    championId.value = null
    addLog('确认发布分组，生成小组赛赛程（24 场）')
    persist()
    return true
  }

  function makeGroupMatch(id, groupId, round, aId, bId) {
    return {
      id,
      stage: 'group',
      groupId,
      round,
      playerAId: aId,
      playerBId: bId,
      sets: emptySets(3),
      status: 'pending',
      forfeitBy: null,
      winnerId: null,
      resultLinks: [],
      disconnect: null,
      createdAt: now(),
      updatedAt: now(),
      log: [],
    }
  }

  function resetTournament() {
    matches.value = []
    draft.value = null
    tiebreakResolutions.value = {}
    evidence.value = []
    championId.value = null
    for (const p of players.value) {
      p.groupId = null
    }
    addLog('重置赛事（保留选手名单）')
    persist()
  }

  // ---------- DDL ----------

  function setDdl(key, value) {
    const item = ddlRounds.value.find((d) => d.key === key)
    if (!item) return
    item.ddl = value || null
    addLog(`设置 ${item.label} DDL：${value || '未设置'}`)
    persist()
  }

  function ddlForMatch(match) {
    if (match.stage === 'group') {
      return ddlRounds.value.find((d) => d.stage === 'group' && d.round === match.round)?.ddl || null
    }
    return ddlRounds.value.find((d) => d.stage === match.stage)?.ddl || null
  }

  // ---------- 赛果 ----------

  function saveMatch(id, payload) {
    const match = matches.value.find((m) => m.id === id)
    if (!match) return null

    match.sets = payload.sets.map((s) => ({
      a: toNum(s.a),
      b: toNum(s.b),
      sdWinner: s.sdWinner || null,
    }))
    if (payload.resultLinks !== undefined) {
      match.resultLinks = payload.resultLinks.filter(Boolean)
    }
    if (payload.disconnect) {
      const toNumOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
      match.disconnect = {
        setIndex: toNumOrNull(payload.disconnect.setIndex),
        holesCompleted: toNumOrNull(payload.disconnect.holesCompleted),
        note: payload.disconnect.note || '',
        links: (payload.disconnect.links || []).filter(Boolean),
      }
    } else {
      match.disconnect = null
    }

    const wins = countSetWins(match)
    const need = match.stage === 'group' ? 2 : 3
    if (wins.A >= need || wins.B >= need) {
      match.status = 'complete'
      match.winnerId = wins.A >= need ? match.playerAId : match.playerBId
      match.updatedAt = now()
      match.log.push({ time: now(), by: '主办方', message: '录入并发布赛果' })
      addLog(`${playerName(match.playerAId)} vs ${playerName(match.playerBId)} 完赛`)
    } else {
      return { ok: false, message: '比分未达到决出胜负所需的胜局数' }
    }

    if (match.stage !== 'group') {
      syncKnockoutInternal()
    } else if (GROUPS.every((g) => groupStageCompleteFor(stateView(), g))) {
      // 小组赛全部结束后生成淘汰赛对阵
      syncKnockoutInternal()
    }
    persist()
    return { ok: true, match }
  }

  function forfeitMatch(id, decision) {
    const match = matches.value.find((m) => m.id === id)
    if (!match) return
    const labels = {
      A: `${playerName(match.playerAId)}负`,
      B: `${playerName(match.playerBId)}负`,
      both: '双方负',
      extend: '延期',
    }
    if (decision === 'extend') {
      match.status = 'pending'
      match.forfeitBy = null
      match.winnerId = null
      match.log.push({ time: now(), by: '主办方', message: '延期处理，恢复待赛' })
    } else {
      match.status = 'forfeit'
      match.forfeitBy = decision
      match.winnerId = matchWinner(match)
      match.updatedAt = now()
      match.log.push({ time: now(), by: '主办方', message: `判定：${labels[decision]}` })
      addLog(`${playerName(match.playerAId)} vs ${playerName(match.playerBId)} 判定 ${labels[decision]}`)
    }
    if (match.stage !== 'group') {
      syncKnockoutInternal()
    } else if (GROUPS.every((g) => groupStageCompleteFor(stateView(), g))) {
      syncKnockoutInternal()
    }
    persist()
  }

  function resolveTiebreak(groupId) {
    const rows = getStandingsFor(stateView(), groupId)
    const unresolved = rows.filter((r) => r.needsDraw)
    if (!unresolved.length) return
    const order = shuffle(unresolved.map((r) => r.playerId))
    tiebreakResolutions.value[groupId] = order
    addLog(`${groupId}组同分选手随机抽签确定排名`)
    // 抽签解决后立即重算晋级对阵，八强名额随即填充
    syncKnockoutInternal()
    persist()
  }

  // ---------- 证据 ----------

  function addEvidence(payload) {
    const item = {
      id: uid('ev'),
      matchId: payload.matchId || null,
      type: payload.type || 'other',
      url: String(payload.url || '').trim(),
      name: String(payload.name || '').trim() || '未命名证据',
      by: payload.by || '主办方',
      time: now(),
    }
    evidence.value.push(item)
    addLog(`上传证据：${item.name}`)
    persist()
    return item
  }

  function removeEvidence(id) {
    const item = evidence.value.find((e) => e.id === id)
    evidence.value = evidence.value.filter((e) => e.id !== id)
    if (item) addLog(`删除证据：${item.name}`)
    persist()
  }

  // ---------- 导出 ----------

  function exportSnapshot() {
    return {
      exportedAt: new Date().toISOString(),
      players: players.value,
      matches: matches.value,
      ddlRounds: ddlRounds.value,
      tiebreakResolutions: tiebreakResolutions.value,
      evidence: evidence.value,
      championId: championId.value,
    }
  }

  function playerName(id) {
    return players.value.find((p) => p.id === id)?.name || '待定'
  }

  function playerById(id) {
    return players.value.find((p) => p.id === id) || null
  }

  // ---------- computed ----------

  const groupMatches = computed(() => {
    const map = {}
    for (const g of GROUPS) {
      map[g] = matches.value
        .filter((m) => m.stage === 'group' && m.groupId === g)
        .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id))
    }
    return map
  })

  const groupComplete = computed(() => {
    const map = {}
    for (const g of GROUPS) {
      map[g] = groupStageCompleteFor(stateView(), g)
    }
    return map
  })

  const allGroupsComplete = computed(() => GROUPS.every((g) => groupComplete.value[g]))

  const stage = computed(() => {
    if (championId.value) return 'finished'
    const hasKnockout = matches.value.some((m) => m.stage !== 'group')
    if (hasKnockout) return 'knockout'
    const hasGroup = players.value.some((p) => p.groupId)
    if (hasGroup) return 'group'
    return 'setup'
  })

  const knockoutMatches = computed(() => {
    const seeds = knockoutSeedMatches(stateView())
    return seeds.map((seed) => {
      const match = matches.value.find(
        (m) => m.stage === seed.stage && m.order === seed.order,
      )
      if (match) {
        return {
          ...seed,
          matchId: match.id,
          playerAId: match.playerAId || seed.a || null,
          playerBId: match.playerBId || seed.b || null,
          sets: match.sets,
          status: match.status,
          winnerId: match.winnerId,
        }
      }
      return {
        ...seed,
        matchId: null,
        playerAId: seed.a,
        playerBId: seed.b,
        sets: emptySets(5),
        status: seed.a && seed.b ? 'pending' : 'locked',
        winnerId: null,
      }
    })
  })

  const pendingCount = computed(
    () => matches.value.filter((m) => m.status === 'pending').length,
  )

  const completedCount = computed(
    () => matches.value.filter((m) => m.status === 'complete' || m.status === 'forfeit').length,
  )

  const overdueMatches = computed(() => {
    const nowMs = now()
    return matches.value
      .filter((m) => {
        if (m.status !== 'pending') return false
        const ddl = ddlForMatch(m)
        return !!ddl && new Date(ddl).getTime() < nowMs
      })
      .map((m) => ({ match: m, ddl: ddlForMatch(m) }))
  })

  const latestResults = computed(() =>
    matches.value
      .filter((m) => m.status === 'complete')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6),
  )

  const ddlByKey = computed(() => {
    const map = {}
    for (const d of ddlRounds.value) map[d.key] = d.ddl || null
    return map
  })

  // 本地引用，避免 this 问题
  function getStandings(groupId) {
    return getStandingsFor(stateView(), groupId)
  }

  function syncKnockoutInternal() {
    syncKnockout(stateView(), persist)
  }

  return {
    players,
    draft,
    matches,
    ddlRounds,
    tiebreakResolutions,
    evidence,
    logs,
    championId,
    runnerUpId,
    drawHistory,
    ready,
    init,
    persist,
    ensureCloudSync,
    addLog,
    addPlayer,
    updatePlayer,
    removePlayer,
    drawGroups,
    setDraftGroup,
    clearDraft,
    constraintValid,
    publishGroups,
    resetTournament,
    setDdl,
    ddlForMatch,
    saveMatch,
    forfeitMatch,
    resolveTiebreak,
    addEvidence,
    removeEvidence,
    exportSnapshot,
    playerName,
    playerById,
    groupMatches,
    groupComplete,
    allGroupsComplete,
    stage,
    knockoutMatches,
    pendingCount,
    completedCount,
    overdueMatches,
    latestResults,
    ddlByKey,
    getStandings,
    matchWinner,
    matchScore,
    STAGE_LABELS,
    STATUS_LABELS,
  }
})

export { GROUPS, STAGE_LABELS, STATUS_LABELS, matchScore, matchWinner }
