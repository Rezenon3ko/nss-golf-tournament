import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  DATA_MODEL,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  TOURNAMENT_STORAGE_KEY,
  USE_SUPABASE,
} from '@/config'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { createRepository, createSeasonRepository } from '@/lib/repository'
import { useFeedbackStore } from '@/stores/feedback'
import { createMirrorController } from '@/lib/mirror'
import {
  fetchCurrentSeason,
  fetchSeasonBundle,
  fetchSeasonPlayers,
  fetchSeasons,
} from '@/lib/seasonData'
import { rowsToSnapshot } from '@/lib/seasonSnapshot'
import { createRealtimeWatcher } from '@/lib/realtime'
import { applyRealtimeChanges } from '@/lib/realtimeMerge'
import {
  SYNC_ROW_KEY,
  WRITE_DEBOUNCE_MS,
  classifySyncError,
  createConflictError,
  createForbiddenError,
  isDuplicateKey,
  isMissingRevisionColumn,
  isNoRowsError,
  nextRetryDelay,
} from '@/lib/sync'
import { countSetWins, countedSets, needWins, setWinnerId } from '@/lib/scoring'
import { nowMs } from '@/lib/clock'

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

// ---------- 空赛事结构 ----------
// 全新环境（云端还没有数据、本机也没有缓存）从空白开始：
// 名单、赛程、赛果都为空，由主办方自行添加；这里只预置 DDL 轮次的结构
// （轮次是规则固定的，具体日期由主办方在「DDL 与逾期」里设置）。
// 不再内置任何示例选手或示例日期，避免把演示数据当成真实赛事数据。

const DDL_ROUNDS = [
  { key: 'group1', label: '小组赛第1轮', stage: 'group', round: 1 },
  { key: 'group2', label: '小组赛第2轮', stage: 'group', round: 2 },
  { key: 'group3', label: '小组赛第3轮', stage: 'group', round: 3 },
  { key: 'qf', label: '八强', stage: 'qf', round: null },
  { key: 'sf', label: '半决赛', stage: 'sf', round: null },
  { key: 'final', label: '决赛', stage: 'final', round: null },
]

function buildDdlRounds() {
  return DDL_ROUNDS.map((round) => ({ ...round, ddl: null }))
}

function buildEmptyState() {
  return {
    players: [],
    draft: null,
    matches: [],
    ddlRounds: buildDdlRounds(),
    tiebreakResolutions: {},
    evidence: [],
    logs: [{ id: 'lg-1', time: now(), by: '系统', message: '初始状态：等待主办方添加选手' }],
    championId: null,
    drawHistory: [],
  }
}

// ---------- 单场比赛结果 ----------

function winsOf(match) {
  return countSetWins(match.sets, match)
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
  const wins = winsOf(match)
  const need = needWins(match.stage)
  if (wins.A >= need) return match.playerAId
  if (wins.B >= need) return match.playerBId
  return null
}

function matchScore(match) {
  const wins = winsOf(match)
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

  // 只统计到决出胜负为止的局：决胜局之后误填的局不计入净胜局/净胜杆
  for (const set of countedSets(match.sets, match)) {
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

// 该场是否已有结论（完赛 / 判负 / 轮空）—— 淘汰赛轮次推进与首页展示共用这一口径
function isMatchDecided(match) {
  return match.status === 'complete' || match.status === 'forfeit' || match.status === 'walkover'
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
        !!a &&
        !!b &&
        a.points === b.points &&
        a.h2hWins === b.h2hWins &&
        a.setDiff === b.setDiff &&
        a.strokeDiff === b.strokeDiff
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
    {
      stage: 'qf',
      order: 1,
      label: '八强 1',
      a: idAt('A', 0),
      b: idAt('B', 1),
      expectedA: 'A组第1名',
      expectedB: 'B组第2名',
    },
    {
      stage: 'qf',
      order: 2,
      label: '八强 2',
      a: idAt('C', 0),
      b: idAt('D', 1),
      expectedA: 'C组第1名',
      expectedB: 'D组第2名',
    },
    {
      stage: 'qf',
      order: 3,
      label: '八强 3',
      a: idAt('A', 1),
      b: idAt('B', 0),
      expectedA: 'A组第2名',
      expectedB: 'B组第1名',
    },
    {
      stage: 'qf',
      order: 4,
      label: '八强 4',
      a: idAt('C', 1),
      b: idAt('D', 0),
      expectedA: 'C组第2名',
      expectedB: 'D组第1名',
    },
    {
      stage: 'sf',
      order: 1,
      label: '半决赛 1',
      a: null,
      b: null,
      expectedA: '八强1胜者',
      expectedB: '八强2胜者',
    },
    {
      stage: 'sf',
      order: 2,
      label: '半决赛 2',
      a: null,
      b: null,
      expectedA: '八强3胜者',
      expectedB: '八强4胜者',
    },
    {
      stage: 'final',
      order: 1,
      label: '决赛',
      a: null,
      b: null,
      expectedA: '上半区胜者',
      expectedB: '下半区胜者',
    },
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

/**
 * 根据小组赛结果推导淘汰赛对阵。
 * 输入是纯数据（state.championId 为值而非 ref），返回本次同步后应写入的冠军。
 */
function syncKnockout(state, persistFn) {
  const seeds = knockoutSeedMatches(state)
  // 只有真正发生变更的分支才改写冠军，其余分支保持原值
  let champion = state.championId ?? null
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
    if (!match || match.status === 'complete') continue
    const [q1, q2] = sfPairs[idx]
    const a = q1 && matchWinner(q1)
    const b = q2 && matchWinner(q2)
    const aVoid = isBothForfeit(q1)
    const bVoid = isBothForfeit(q2)
    if (match.status === 'forfeit') {
      // 一方退赛判负、对手待定：等对手确定后自动补位并让其晋级
      let filled = false
      if (!match.playerAId && a) {
        match.playerAId = a
        filled = true
      }
      if (!match.playerBId && b) {
        match.playerBId = b
        filled = true
      }
      if (filled) {
        match.updatedAt = now()
        match.log.push({ time: now(), by: '系统', message: '对手已确定，自动判定晋级' })
        if (match.playerAId && match.playerBId) match.winnerId = matchWinner(match)
      }
      continue
    }
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
  const sf1Ref = existing('sf', 1)
  const sf2Ref = existing('sf', 2)
  const finalF1 = sfWalkover[1] || (sf1Ref && matchWinner(sf1Ref))
  const finalF2 = sfWalkover[2] || (sf2Ref && matchWinner(sf2Ref))
  if (final && final.status === 'forfeit' && (!final.playerAId || !final.playerBId)) {
    // 决赛一方退赛、对手待定：对手确定后补位，由其获得冠军
    if (!final.playerAId && finalF1) final.playerAId = finalF1
    if (!final.playerBId && finalF2) final.playerBId = finalF2
    if (final.playerAId && final.playerBId) {
      final.winnerId = matchWinner(final)
      final.updatedAt = now()
      final.log.push({ time: now(), by: '系统', message: '对手已确定，自动判定晋级' })
    }
  }
  if (final && (final.status === 'pending' || final.status === 'walkover')) {
    const sf1 = sf1Ref
    const sf2 = sf2Ref
    const f1 = finalF1
    const f2 = finalF2
    // 半区"整体作废"：半决赛本身双方负、半决赛被取消（该半区八强全部双方负），
    // 或半决赛一方退赛判负而对手那侧八强双方负（该侧永远无人）
    const sfMissingVoid = (n, sf) => {
      if (!sf || sf.status !== 'forfeit' || sf.winnerId) return false
      const [q1, q2] = sfPairs[n - 1]
      return (!sf.playerAId && isBothForfeit(q1)) || (!sf.playerBId && isBothForfeit(q2))
    }
    const sf1Void =
      isBothForfeit(sf1) ||
      (sf1 && sf1.status === 'walkover' && !sfWalkover[1]) ||
      sfMissingVoid(1, sf1)
    const sf2Void =
      isBothForfeit(sf2) ||
      (sf2 && sf2.status === 'walkover' && !sfWalkover[2]) ||
      sfMissingVoid(2, sf2)
    final.playerAId = f1 || null
    final.playerBId = f2 || null
    if (f1 && f2) {
      final.walkover = null
      final.runnerUpId = null
      if (final.status === 'walkover') final.status = 'pending'
    } else if (f1 && sf2Void) {
      // 下半区整体作废：上半区决赛选手直接夺冠；若其半决赛真实完赛，败者递补亚军
      const champ = f1
      const runnerUp = !sfWalkover[1] && sf1 && matchWinner(sf1) === champ ? loserOf(sf1) : null
      final.playerAId = champ
      final.playerBId = null
      final.walkover = '对手半区作废，直接夺冠'
      final.runnerUpId = runnerUp
      final.status = 'walkover'
      champion = champ
    } else if (f2 && sf1Void) {
      // 上半区整体作废：下半区决赛选手直接夺冠；若其半决赛真实完赛，败者递补亚军
      const champ = f2
      const runnerUp = !sfWalkover[2] && sf2 && matchWinner(sf2) === champ ? loserOf(sf2) : null
      final.playerAId = champ
      final.playerBId = null
      final.walkover = '对手半区作废，直接夺冠'
      final.runnerUpId = runnerUp
      final.status = 'walkover'
      champion = champ
    } else if (sf1Void && sf2Void) {
      final.walkover = '双方半区作废，决赛取消'
      final.runnerUpId = null
      final.status = 'walkover'
      champion = null
    } else {
      // 至少一侧尚未决出：决赛保持待定，不提前确定冠军
      final.walkover = null
      final.runnerUpId = null
      if (final.status === 'walkover') final.status = 'pending'
      champion = null
    }
  }

  if (final && (final.status === 'complete' || final.status === 'forfeit')) {
    champion = matchWinner(final)
    final.runnerUpId = null
  }

  persistFn()
  return champion
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
  const adminAvatar = ref(null)
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
  // ---------- 云端同步状态 ----------
  // mode：local（未配置云端，或读不到云端时的降级模式）| cloud（云端为唯一真相）
  // status：idle | saving | error | conflict | local-only
  const sync = reactive({
    mode: 'local',
    status: 'idle',
    message: '',
    revision: 0,
    // 数据库是否已升级出 revision / updated_at 列（未升级则退回覆盖式写入）
    supportsRevision: true,
    // 是否存在尚未成功写入云端的改动
    pendingChanges: false,
    // 是否处于「读不到云端，只写本机」的降级模式
    degraded: false,
    lastSyncedAt: null,
    // 版本冲突时的云端快照，供主办方选择保留哪一份
    conflictRemote: null,
  })
  // 只有主办方登录后才允许写云端（RLS 需要登录态，游客写入必然是 401）
  const cloudWriteEnabled = ref(false)

  // ---------- 多表模式（Phase 2，VITE_DATA_MODEL=multi 时启用） ----------
  // 数据以 Supabase 多表为唯一真相：读取走各表，写入走事务函数（RPC）；
  // 旧单文档只作为「回滚备份」异步补写，失败不影响主流程，也不会弹冲突。
  const mirror = reactive({
    model: DATA_MODEL,
    enabled: false,
    // off：未启用该模式 | connecting：正在读取多表（初始化中）
    // disabled：启用了但没找到赛季 / 表不存在 | idle：已同步
    // syncing：同步中 | error：失败待重试
    // 注意：初始化期间不能用 disabled，否则刷新瞬间会误报「多表同步未完成」
    status: DATA_MODEL === 'multi' ? 'connecting' : 'off',
    message: '',
    seasonId: null,
    // off | connecting | subscribed | error：实时订阅状态
    realtime: 'off',
  })
  let mirrorController = null
  let mirrorInFlight = false
  let mirrorRetryTimer = null
  let mirrorRetryAttempt = 0
  // 是否已成功从多表读取并挂好仓储；未就绪时回退单文档模式
  let multiModelReady = false
  let realtimeWatcher = null
  let realtimeRefetchPending = false

  function mirrorActive() {
    return DATA_MODEL === 'multi' && multiModelReady && mirror.enabled && !!mirrorController
  }

  function mirrorStateView() {
    return {
      players: players.value,
      matches: matches.value,
      ddlRounds: ddlRounds.value,
      tiebreakResolutions: tiebreakResolutions.value,
      evidence: evidence.value,
      championId: championId.value,
      runnerUpId: runnerUpId.value,
      draft: draft.value,
      logs: logs.value,
      drawHistory: drawHistory.value,
    }
  }

  function classifyMirrorError(error) {
    const message = String(error?.message || '')
    const code = String(error?.code || '')
    if (code === 'PT409') return '多表数据版本不一致，需要重新跑一次迁移脚本'
    if (code === 'PT423') return '当前赛季已归档，处于只读状态；如需编辑请先取消归档'
    if (code === 'PT404') return '多表里没有当前赛季，请先执行迁移脚本'
    if (code === '42501' || /row-level security|permission denied/i.test(message)) {
      return '当前账号没有多表写入权限'
    }
    return '多表同步失败，稍后自动重试'
  }

  function readSelectedSeasonId() {
    if (typeof window === 'undefined') return null
    try {
      return window.localStorage.getItem('ghostfish.currentSeason') || null
    } catch {
      return null
    }
  }

  function writeSelectedSeasonId(seasonId) {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem('ghostfish.currentSeason', seasonId)
    } catch {
      // 忽略：选择只在下次打开时用于定位赛季
    }
  }

  // 多表读取：定位赛季 → 拉整季数据 → 组装成 store 快照 → 挂载镜像控制器
  async function initMultiModel() {
    mirror.status = 'connecting'
    mirror.message = ''
    const supabase = await getSupabase()
    if (!supabase) throw new Error('Supabase 未初始化')

    const season = await fetchCurrentSeason(supabase, readSelectedSeasonId())
    if (!season) throw new Error('还没有任何赛季')
    const bundle = await fetchSeasonBundle(supabase, season.id)
    applySnapshot({ ...rowsToSnapshot(bundle), adminAvatar: adminAvatar.value ?? null })
    writeSelectedSeasonId(season.id)

    mirrorController = createMirrorController({
      repository: createRepository(supabase, season.id),
      storage: typeof window !== 'undefined' ? window.localStorage : null,
      baselineKey: `ghostfish.mirror.${season.id}.v1`,
    })
    // 读取即基线：刚读到的就是各表当前状态，避免把远端数据当成待推送的差异
    mirrorController.setBaseline(mirrorStateView())
    mirror.seasonId = season.id
    currentSeasonId.value = season.id
    currentSeason.value = season
    mirror.enabled = true
    mirror.status = 'idle'
    mirror.message = ''
    multiModelReady = true

    sync.mode = 'cloud'
    sync.degraded = false
    sync.status = 'idle'
    sync.message = ''
    sync.revision = Number(season.revision ?? 0)
    sync.pendingChanges = false
    sync.lastSyncedAt = Date.now()
    persistLocal()
    void refreshAdminAvatar()
    void startRealtime()
  }

  // 主办方头像：登录后能读到自己的那一行（RLS 限制），匿名时静默跳过
  async function refreshAdminAvatar() {
    try {
      const supabase = await getSupabase()
      if (!supabase) return
      const { data, error } = await supabase.from('admin_profiles').select('avatar_url').limit(1)
      if (error) return
      const url = data?.[0]?.avatar_url ?? null
      if (url !== adminAvatar.value) {
        adminAvatar.value = url
        persistLocal()
      }
    } catch {
      // 忽略：匿名访问读不到是正常现象
    }
  }

  // ---------- 实时订阅（观众端增量更新） ----------
  function handleRealtimeStatus(info) {
    if (info.status === 'subscribed') {
      mirror.realtime = 'subscribed'
      if (info.resubscribed) {
        // 断线期间可能漏掉事件：做一次全量补偿
        if (sync.pendingChanges) realtimeRefetchPending = true
        else void refetchSeason()
      }
    } else if (info.status === 'error') {
      mirror.realtime = 'error'
    } else {
      mirror.realtime = 'off'
    }
  }

  function applyRealtimeBatch(changes) {
    if (!mirrorActive()) return
    const merged = applyRealtimeChanges(
      {
        players: players.value,
        matches: matches.value,
        ddlRounds: ddlRounds.value,
        evidence: evidence.value,
      },
      changes,
    )
    if (!merged.changed) return

    if (merged.season) {
      championId.value = merged.season.champion_player_id ?? null
      const final = matches.value.find((match) => match.stage === 'final')
      if (final) {
        if (merged.season.runner_up_player_id) final.runnerUpId = merged.season.runner_up_player_id
        else delete final.runnerUpId
      }
    }
    if (merged.tiebreakRefetch) void refetchTiebreaks()

    // 没有本机待同步改动时，把读取到的最新状态当作基线，避免回声再推回去
    if (!sync.pendingChanges && mirrorController) {
      mirrorController.setBaseline(mirrorStateView())
      persistLocal()
    }
  }

  async function refetchTiebreaks() {
    try {
      const supabase = await getSupabase()
      if (!supabase) return
      const { data, error } = await supabase
        .from('tiebreak_resolutions')
        .select('*')
        .eq('season_id', mirror.seasonId)
      if (error) throw error

      const next = {}
      for (const groupId of GROUPS) {
        const order = (data || [])
          .filter((row) => row.group_id === groupId)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((row) => row.player_id)
        if (order.length) next[groupId] = order
      }
      tiebreakResolutions.value = next
      if (!sync.pendingChanges && mirrorController) {
        mirrorController.setBaseline(mirrorStateView())
      }
    } catch (err) {
      console.warn('抽签解决记录刷新失败：', err?.message || err)
    }
  }

  async function refetchSeason() {
    if (!mirrorActive()) return
    try {
      const supabase = await getSupabase()
      if (!supabase) return
      const bundle = await fetchSeasonBundle(supabase, mirror.seasonId)
      applySnapshot({ ...rowsToSnapshot(bundle), adminAvatar: adminAvatar.value ?? null })
      persistLocal()
      mirrorController.setBaseline(mirrorStateView())
    } catch (err) {
      console.warn('赛季数据全量刷新失败：', err?.message || err)
    }
  }

  async function startRealtime() {
    if (typeof window === 'undefined' || !isSupabaseConfigured()) return
    try {
      if (realtimeWatcher) await realtimeWatcher.close()
      mirror.realtime = 'connecting'
      realtimeWatcher = await createRealtimeWatcher({
        url: SUPABASE_URL,
        apiKey: SUPABASE_ANON_KEY,
        seasonId: mirror.seasonId,
        onChanges: applyRealtimeBatch,
        onStatus: handleRealtimeStatus,
      })
    } catch (err) {
      console.warn('实时订阅失败：', err?.message || err)
      mirror.realtime = 'error'
    }
  }

  // 旧文档只作回滚备份：多表写入成功后异步补写，失败不影响主流程。
  // 这里不做版本校验（备份允许覆盖），revision / 时间戳由数据库触发器盖章，
  // 旧版客户端仍能因此检测到「别处改了数据」。
  async function writeDocBackup() {
    if (!isSupabaseConfigured()) return
    try {
      const supabase = await getSupabase()
      if (!supabase) return
      const { error } = await supabase
        .from('tournament_state')
        .upsert({ key: SYNC_ROW_KEY, value: snapshot() }, { onConflict: 'key' })
      if (error) throw error
    } catch (err) {
      console.warn('旧文档备份写入失败（不影响多表模式）：', err?.message || err)
    }
  }

  // 发布分组 / 重置赛事属于结构级操作，由对应的整体 RPC 处理
  function mirrorWholesale(kind) {
    if (mirrorActive()) mirrorController.setWholesale(kind)
  }

  async function flushMulti() {
    if (!mirrorActive() || mirrorInFlight) return
    if (!cloudWriteEnabled.value) return

    const state = mirrorStateView()
    if (!mirrorController.pending(state) && !sync.pendingChanges) {
      mirror.status = 'idle'
      mirror.message = ''
      return
    }

    mirrorInFlight = true
    sync.status = 'saving'
    mirror.status = 'syncing'
    mirror.message = ''
    try {
      await mirrorController.sync(state)
      mirrorRetryAttempt = 0
      mirror.status = 'idle'
      mirror.message = ''
      sync.pendingChanges = false
      sync.status = 'idle'
      sync.lastSyncedAt = Date.now()
      persistLocal()
      void writeDocBackup()
      if (realtimeRefetchPending) {
        realtimeRefetchPending = false
        void refetchSeason()
      }
    } catch (err) {
      console.warn('多表同步失败：', err?.message || err)
      mirror.status = 'error'
      mirror.message = classifyMirrorError(err)
      sync.status = 'idle'
      sync.pendingChanges = true
      clearTimeout(mirrorRetryTimer)
      mirrorRetryAttempt += 1
      mirrorRetryTimer = setTimeout(() => {
        void flushMulti()
      }, nextRetryDelay(mirrorRetryAttempt))
    } finally {
      mirrorInFlight = false
    }
  }

  // 手动重试：多表未就绪时先重新走一遍「读取 → 挂载」
  async function retryMirror() {
    if (DATA_MODEL !== 'multi') return false
    if (!mirrorActive()) {
      try {
        await initMultiModel()
      } catch (err) {
        mirror.enabled = false
        mirror.status = 'disabled'
        mirror.message = `多表读取失败：${err?.message || '未知原因'}`
        return false
      }
    }
    await flushMulti()
    return mirror.status !== 'error'
  }

  // ---------- 赛季管理（多表模式） ----------
  const seasons = ref([])
  const currentSeasonId = ref(null)
  // 当前赛季的完整行（含名称），供首页副标题等展示；重命名后随列表刷新
  const currentSeason = ref(null)
  const currentSeasonName = computed(() => String(currentSeason.value?.name || ''))
  // 归档赛季只读：多表模式下当前赛季已归档时，所有写入在动作入口就被拦下
  const readOnly = computed(() => DATA_MODEL === 'multi' && !!currentSeason.value?.is_archived)

  function guardReadOnly() {
    if (!readOnly.value) return false
    useFeedbackStore().warn('当前赛季已归档，处于只读状态；如需编辑请先在「赛季管理」里取消归档')
    return true
  }

  function translateSeasonError(error) {
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    if (code === 'PT409') return message || '操作冲突：slug 已被占用，或赛季还有关联数据'
    if (code === 'PT423') return message || '该赛季已归档，处于只读状态'
    if (code === 'PT400') return message || '参数不合法'
    if (code === '42501' || /row-level security|permission denied/i.test(message)) {
      return '当前账号没有赛季管理权限'
    }
    return message || '操作失败，请稍后重试'
  }

  async function loadSeasons() {
    if (DATA_MODEL !== 'multi' || !isSupabaseConfigured()) return []
    try {
      const supabase = await getSupabase()
      if (!supabase) return []
      seasons.value = await fetchSeasons(supabase)
      const fresh = seasons.value.find((item) => item.id === currentSeasonId.value)
      if (fresh) currentSeason.value = fresh
      return seasons.value
    } catch (err) {
      console.warn('赛季列表读取失败：', err?.message || err)
      return []
    }
  }

  async function loadSeasonPlayers(seasonIds) {
    if (DATA_MODEL !== 'multi' || !isSupabaseConfigured()) return []
    try {
      const supabase = await getSupabase()
      if (!supabase) return []
      return await fetchSeasonPlayers(supabase, seasonIds)
    } catch (err) {
      console.warn('赛季名单读取失败：', err?.message || err)
      return []
    }
  }

  // 切换赛季：写本机选择 → 重新读取 → 重订阅（有未同步改动时拒绝，避免丢改动）
  async function switchSeason(seasonId) {
    if (DATA_MODEL !== 'multi') return { ok: false, message: '当前不是多表模式' }
    if (!seasonId || seasonId === mirror.seasonId) return { ok: true }
    if (sync.pendingChanges) {
      return { ok: false, message: '还有未同步的改动，请稍后再切换赛季' }
    }
    writeSelectedSeasonId(seasonId)
    try {
      await initMultiModel()
      await loadSeasons()
      return { ok: true }
    } catch (err) {
      console.warn('切换赛季失败：', err?.message || err)
      return { ok: false, message: `切换赛季失败：${err?.message || '未知原因'}` }
    }
  }

  async function createSeason(payload) {
    try {
      const supabase = await getSupabase()
      if (!supabase) return { ok: false, message: '未配置云端' }
      const season = await createSeasonRepository(supabase).create(payload)
      await loadSeasons()
      return { ok: true, season }
    } catch (err) {
      return { ok: false, message: translateSeasonError(err) }
    }
  }

  async function updateSeason(seasonId, patch) {
    try {
      const supabase = await getSupabase()
      if (!supabase) return { ok: false, message: '未配置云端' }
      const season = await createSeasonRepository(supabase).update(seasonId, patch)
      await loadSeasons()
      return { ok: true, season }
    } catch (err) {
      return { ok: false, message: translateSeasonError(err) }
    }
  }

  async function setCurrentSeason(seasonId) {
    try {
      const supabase = await getSupabase()
      if (!supabase) return { ok: false, message: '未配置云端' }
      const season = await createSeasonRepository(supabase).setCurrent(seasonId)
      await loadSeasons()
      return { ok: true, season }
    } catch (err) {
      return { ok: false, message: translateSeasonError(err) }
    }
  }

  async function archiveSeason(seasonId, archived = true) {
    try {
      const supabase = await getSupabase()
      if (!supabase) return { ok: false, message: '未配置云端' }
      const season = await createSeasonRepository(supabase).archive(seasonId, archived)
      await loadSeasons()
      return { ok: true, season }
    } catch (err) {
      return { ok: false, message: translateSeasonError(err) }
    }
  }

  async function deleteSeason(seasonId) {
    try {
      const supabase = await getSupabase()
      if (!supabase) return { ok: false, message: '未配置云端' }
      const wasViewing = seasonId === mirror.seasonId
      const result = await createSeasonRepository(supabase).remove(seasonId)
      await loadSeasons()
      // 删掉的正是当前正在看的赛季：切回默认赛季（本机选择失效后自动回落到当前赛季）
      if (wasViewing) {
        try {
          await initMultiModel()
        } catch (err) {
          console.warn('删除赛季后重新加载失败：', err?.message || err)
        }
      }
      return { ok: true, result }
    } catch (err) {
      return { ok: false, message: translateSeasonError(err) }
    }
  }

  let flushTimer = null
  let retryTimer = null
  let retryAttempt = 0
  let inFlight = false
  let localQueued = false
  let cloudQueued = false

  function snapshot() {
    return {
      players: players.value,
      draft: draft.value,
      matches: matches.value,
      ddlRounds: ddlRounds.value,
      tiebreakResolutions: tiebreakResolutions.value,
      evidence: evidence.value,
      logs: logs.value,
      championId: championId.value,
      drawHistory: drawHistory.value,
      adminAvatar: adminAvatar.value,
    }
  }

  function applySnapshot(data) {
    if (!data) return
    players.value = data.players || []
    draft.value = data.draft || null
    matches.value = data.matches || []
    ddlRounds.value = data.ddlRounds || []
    tiebreakResolutions.value = data.tiebreakResolutions || {}
    evidence.value = data.evidence || []
    logs.value = data.logs || []
    championId.value = data.championId || null
    drawHistory.value = data.drawHistory || []
    adminAvatar.value = data.adminAvatar || null
  }

  function persistLocal() {
    try {
      // __pending 标记「本地有尚未成功写入云端的改动」，
      // 下次打开时即便云端可读，也不会静默丢弃本机改动
      localStorage.setItem(
        TOURNAMENT_STORAGE_KEY,
        JSON.stringify({ ...snapshot(), __pending: sync.pendingChanges }),
      )
    } catch (err) {
      console.warn('本地缓存写入失败：', err?.message || err)
    }
  }

  // 每次修改都会调用：本地缓存立即排队，云端写入防抖合并
  function persist() {
    localQueued = true
    if (mirrorActive()) {
      // 多表模式：RPC 直写（flushMulti），旧文档只作备份
      sync.pendingChanges = true
      scheduleFlush()
      return
    }
    if (sync.degraded) {
      // 读不到云端时不写云端，只把改动留在本机，等待主办方决定
      sync.pendingChanges = true
    } else if (sync.mode === 'cloud' && sync.status !== 'conflict') {
      sync.pendingChanges = true
      if (cloudWriteEnabled.value) {
        cloudQueued = true
        if (sync.status !== 'error') sync.status = 'saving'
      }
    }
    scheduleFlush()
  }

  function scheduleFlush(delay = WRITE_DEBOUNCE_MS) {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(flushQueued, delay)
  }

  function flushQueued() {
    clearTimeout(flushTimer)
    if (localQueued) {
      localQueued = false
      persistLocal()
    }
    if (mirrorActive()) {
      void flushMulti()
      return
    }
    if (cloudQueued && !inFlight) void flushCloud()
  }

  // ---------- 云端读写 ----------

  // 读取云端快照：老库缺 revision 列时自动降级
  async function fetchRemoteRow() {
    const supabase = await getSupabase()
    if (!supabase) throw new Error('Supabase 未初始化')
    const columns = sync.supportsRevision ? 'value,revision' : 'value'
    const { data, error } = await supabase
      .from('tournament_state')
      .select(columns)
      .eq('key', SYNC_ROW_KEY)
      .maybeSingle()
    if (error) {
      if (sync.supportsRevision && isMissingRevisionColumn(error)) {
        console.warn('数据库缺少 revision 列，退回覆盖式写入；建议重新执行 supabase/schema.sql')
        sync.supportsRevision = false
        return fetchRemoteRow()
      }
      // 表里还没有 main 行（首次部署）不是错误，交给上层走「首次写入」分支
      if (isNoRowsError(error)) return null
      throw error
    }
    if (!data) return null
    return { value: data.value, revision: data.revision == null ? 0 : Number(data.revision) }
  }

  // 带乐观锁的写入：只有云端版本仍是我们读取的那一版才允许覆盖
  async function writeSnapshot(payload) {
    const supabase = await getSupabase()
    if (!supabase) throw new Error('Supabase 未初始化')

    if (!sync.supportsRevision) {
      const { error } = await supabase
        .from('tournament_state')
        .upsert({ key: SYNC_ROW_KEY, value: payload }, { onConflict: 'key' })
      if (error) throw error
      return
    }

    const baseRevision = sync.revision
    const nextRevision = baseRevision + 1
    const row = {
      value: payload,
      revision: nextRevision,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('tournament_state')
      .update(row)
      .eq('key', SYNC_ROW_KEY)
      .eq('revision', baseRevision)
      .select('revision')

    if (error) {
      if (isMissingRevisionColumn(error)) {
        console.warn('数据库缺少 revision 列，退回覆盖式写入；建议重新执行 supabase/schema.sql')
        sync.supportsRevision = false
        return writeSnapshot(payload)
      }
      throw error
    }

    // 更新未命中：要么行不存在（首次写入），要么云端版本已被别人推进
    if (!data || data.length === 0) {
      const remote = await fetchRemoteRow()
      if (remote) {
        // 版本号没变却更新不到行 → 不是并发冲突，是写入没被放行（RLS）
        if (Number(remote.revision) === Number(baseRevision)) throw createForbiddenError()
        throw createConflictError(remote)
      }

      const inserted = await supabase.from('tournament_state').insert({ key: SYNC_ROW_KEY, ...row })
      if (inserted.error) {
        if (isDuplicateKey(inserted.error)) throw createConflictError(await fetchRemoteRow())
        if (isMissingRevisionColumn(inserted.error)) {
          sync.supportsRevision = false
          return writeSnapshot(payload)
        }
        throw inserted.error
      }
      sync.revision = nextRevision
      return
    }

    sync.revision = Number(data[0].revision ?? nextRevision)
  }

  async function flushCloud() {
    if (inFlight || !cloudQueued) return
    if (!cloudWriteEnabled.value || !isSupabaseConfigured()) return
    if (sync.mode !== 'cloud' || sync.status === 'conflict') return

    cloudQueued = false
    inFlight = true
    const retrying = sync.status === 'error'
    sync.status = 'saving'
    if (!retrying) sync.message = ''

    try {
      await writeSnapshot(snapshot())
      retryAttempt = 0
      sync.lastSyncedAt = Date.now()
      sync.degraded = false
      if (cloudQueued) {
        // 写入期间又有新改动，继续排队写
        sync.status = 'saving'
      } else {
        sync.pendingChanges = false
        sync.status = 'idle'
        sync.message = ''
        persistLocal()
      }
    } catch (err) {
      if (err?.isConflict) {
        sync.status = 'conflict'
        sync.message = '云端数据已被其他设备更新，请选择保留哪一份'
        sync.conflictRemote = err.remote || null
        sync.pendingChanges = true
        cloudQueued = false
      } else {
        const info = classifySyncError(err)
        console.error('Supabase 写入失败：', err?.message || err)
        sync.status = 'error'
        sync.message = info.message
        sync.pendingChanges = true
        cloudQueued = true
        scheduleRetry()
      }
    } finally {
      inFlight = false
      if (cloudQueued && sync.status !== 'conflict' && sync.status !== 'error') {
        void flushCloud()
      }
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer)
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      if (cloudQueued && sync.status === 'error') void flushCloud()
    }, nextRetryDelay(retryAttempt))
  }

  // 主办方登录状态变化时调用；首次登录会把待同步的改动推上去
  function setCloudWriteEnabled(enabled) {
    cloudWriteEnabled.value = !!enabled
    if (mirrorActive()) {
      if (enabled) {
        void refreshAdminAvatar()
        if (sync.pendingChanges) flushQueued()
        else void flushMulti()
      }
      return
    }
    if (enabled && sync.mode === 'cloud' && sync.pendingChanges && sync.status !== 'conflict') {
      cloudQueued = true
      flushQueued()
    }
  }

  // 手动重试：写入失败时重发，降级模式下重新尝试连接云端
  async function retrySync() {
    clearTimeout(retryTimer)
    retryAttempt = 0
    if (sync.degraded) return reconnect()
    if (sync.status === 'error') {
      cloudQueued = true
      await flushCloud()
      return sync.status === 'idle'
    }
    return !sync.pendingChanges
  }

  // 降级模式（读不到云端）下重新连接
  async function reconnect() {
    if (!isSupabaseConfigured()) return false
    sync.status = 'saving'
    sync.message = ''
    try {
      const row = await fetchRemoteRow()
      sync.mode = 'cloud'
      sync.degraded = false
      if (!row) {
        // 云端还没有数据：把本机数据推上去
        sync.revision = 0
        sync.pendingChanges = true
        cloudQueued = true
        await flushCloud()
        return true
      }
      if (sync.pendingChanges) {
        // 本机有未同步的改动，云端也有数据：由主办方决定保留哪一份
        sync.status = 'conflict'
        sync.message = '本机存在未同步的改动，云端也已有数据，请选择保留哪一份'
        sync.conflictRemote = row
        return true
      }
      applySnapshot(row.value)
      persistLocal()
      sync.revision = row.revision
      sync.status = 'idle'
      sync.lastSyncedAt = Date.now()
      return true
    } catch (err) {
      console.warn('Supabase 读取失败：', err?.message || err)
      sync.mode = 'local'
      sync.degraded = true
      sync.status = 'local-only'
      sync.message = '仍未能连接云端，当前修改只保存在本机'
      return false
    }
  }

  // 冲突处理：采用云端版本（丢弃本机未同步改动）
  function useRemoteVersion() {
    const remote = sync.conflictRemote
    if (!remote) return
    applySnapshot(remote.value)
    persistLocal()
    clearTimeout(retryTimer)
    retryAttempt = 0
    cloudQueued = false
    sync.revision = remote.revision
    sync.conflictRemote = null
    sync.pendingChanges = false
    sync.status = 'idle'
    sync.message = ''
  }

  // 冲突处理：用本机版本覆盖云端（以云端最新版本号为基线重写）
  async function useLocalVersion() {
    const remote = sync.conflictRemote
    if (!remote) return false
    sync.revision = remote.revision
    sync.conflictRemote = null
    sync.status = 'saving'
    sync.message = ''
    cloudQueued = true
    await flushCloud()
    return sync.status === 'idle'
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      if (sync.status === 'error' || sync.degraded) void retrySync()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && sync.status === 'error') void retrySync()
    })
    // 关页面前把防抖中的本地缓存落盘，避免最后一笔改动丢失
    window.addEventListener('beforeunload', () => {
      if (localQueued) {
        localQueued = false
        persistLocal()
      }
    })
  }

  function stateView() {
    return {
      players: players.value,
      matches: matches.value,
      tiebreakResolutions: tiebreakResolutions.value,
      championId: championId.value,
    }
  }

  // 读取本机缓存；found=是否有缓存，pending=缓存里是否带着未同步的改动
  function loadLocal() {
    try {
      const raw = localStorage.getItem(TOURNAMENT_STORAGE_KEY)
      if (!raw) return { found: false, pending: false }
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.players)) return { found: false, pending: false }
      applySnapshot(data)
      return { found: true, pending: data.__pending === true }
    } catch {
      return { found: false, pending: false }
    }
  }

  // 全新环境：置为空白赛事（保留 DDL 轮次结构，日期留空由主办方设置）
  function initEmptyState() {
    const empty = buildEmptyState()
    players.value = empty.players
    draft.value = empty.draft
    matches.value = empty.matches
    ddlRounds.value = empty.ddlRounds
    tiebreakResolutions.value = empty.tiebreakResolutions
    evidence.value = empty.evidence
    logs.value = empty.logs
    championId.value = empty.championId
    drawHistory.value = empty.drawHistory || []
  }

  async function init() {
    if (USE_SUPABASE && DATA_MODEL === 'multi') {
      // Phase 2：多表读取为主；失败回退单文档模式并在提示条说明
      const cached = loadLocal()
      if (cached.found) ready.value = true
      try {
        await initMultiModel()
        ready.value = true
        return
      } catch (err) {
        console.warn('多表读取失败：', err?.message || err, '→ 回退单文档模式')
        mirror.enabled = false
        multiModelReady = false
        mirror.status = 'disabled'
        mirror.message = `多表读取失败，已回退单文档模式：${err?.message || '未知原因'}`
      }
    }

    if (USE_SUPABASE) {
      // 先用本机缓存把界面渲染出来（重复访问几乎瞬时），云端数据随后到达再更新。
      // 同时提前进入 cloud 记账模式：这样「启动窗口内的编辑」会被标记为待同步，
      // 而不是被当成无事发生、随后被云端快照覆盖。
      const cached = loadLocal()
      if (cached.found) ready.value = true
      sync.mode = 'cloud'

      try {
        const row = await fetchRemoteRow()
        sync.degraded = false
        sync.status = 'idle'
        // 本机有未同步的改动（上次关页没传成功，或本次打开后立刻编辑）：
        // 保留本机状态，把云端那份交给主办方选择，绝不静默覆盖
        if (row && (sync.pendingChanges || (cached.found && cached.pending))) {
          sync.revision = row.revision
          sync.pendingChanges = true
          sync.conflictRemote = row
          sync.status = 'conflict'
          sync.message = '本机有未同步的改动，云端也已有数据，请选择保留哪一份'
          ready.value = true
          return
        }
        if (row) {
          applySnapshot(row.value)
          // 本地留一份缓存，云端暂时不可用时至少能看到最近的数据
          sync.revision = row.revision
          sync.pendingChanges = false
          sync.lastSyncedAt = Date.now()
          persistLocal()
        } else {
          // 云端建好表但还没有数据：先保留本地/种子数据，
          // 首次写入等主办方登录后由 setCloudWriteEnabled 触发（游客无写权限）
          sync.revision = 0
          if (!cached.found) initEmptyState()
          sync.pendingChanges = true
        }
        ready.value = true
        return
      } catch (err) {
        // 云端读取失败：降级为「本地模式」，明确告知主办方改动不会上云，
        // 绝不静默当作已同步
        console.warn('Supabase 读取失败：', err?.message || err, '→ 进入本地模式')
        sync.mode = 'local'
        sync.degraded = true
        sync.status = 'local-only'
        sync.message = '未能连接云端，当前修改只保存在本机'
        if (!cached.found) initEmptyState()
        // 缓存里已有未同步改动时，重连后同样交给主办方选择
        if (cached.pending) sync.pendingChanges = true
        ready.value = true
        return
      }
    }
    sync.mode = 'local'
    if (!loadLocal().found) {
      initEmptyState()
      persistLocal()
    }
    if (DATA_MODEL === 'multi') {
      // 本地模式没有多表可读：明确说明，而不是一直停在 connecting
      mirror.status = 'disabled'
      mirror.message = '未启用多表同步：当前是本地模式'
    }
    ready.value = true
  }

  function addLog(message, by = '主办方') {
    logs.value.unshift({ id: uid('lg'), time: now(), by, message })
  }

  // ---------- 选手与分组 ----------

  function addPlayer(payload) {
    if (guardReadOnly()) return null
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
    if (guardReadOnly()) return
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
    if (guardReadOnly()) return false
    const hasMatches = matches.value.some((m) => m.playerAId === id || m.playerBId === id)
    if (hasMatches) return false
    const player = players.value.find((p) => p.id === id)
    players.value = players.value.filter((p) => p.id !== id)
    if (player) addLog(`删除选手 ${player.name}`)
    persist()
    return true
  }

  function drawGroups() {
    if (guardReadOnly()) return
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
    if (guardReadOnly()) return
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
    if (guardReadOnly()) return
    draft.value = null
    addLog('清空手动分组选择')
    persist()
  }

  function publishGroups() {
    if (guardReadOnly()) return false
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
    mirrorWholesale('publish')
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
    if (guardReadOnly()) return
    matches.value = []
    draft.value = null
    tiebreakResolutions.value = {}
    evidence.value = []
    championId.value = null
    for (const p of players.value) {
      p.groupId = null
    }
    addLog('重置赛事（保留选手名单）')
    mirrorWholesale('reset')
    persist()
  }

  // ---------- DDL ----------

  function setDdl(key, value) {
    if (guardReadOnly()) return
    const item = ddlRounds.value.find((d) => d.key === key)
    if (!item) return
    item.ddl = value || null
    addLog(`设置 ${item.label} DDL：${value || '未设置'}`)
    persist()
  }

  function ddlForMatch(match) {
    if (match.stage === 'group') {
      return (
        ddlRounds.value.find((d) => d.stage === 'group' && d.round === match.round)?.ddl || null
      )
    }
    return ddlRounds.value.find((d) => d.stage === match.stage)?.ddl || null
  }

  // ---------- 赛果 ----------

  function saveMatch(id, payload) {
    if (guardReadOnly()) return { ok: false, message: '当前赛季已归档，处于只读状态' }
    const match = matches.value.find((m) => m.id === id)
    if (!match) return null
    // 对阵双方尚未确定（如半决赛对手待定）时不允许录入，避免错误晋级
    if (!match.playerAId || !match.playerBId) {
      return { ok: false, message: '对阵双方尚未确定，暂不能录入比分' }
    }

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

    const wins = winsOf(match)
    const need = needWins(match.stage)
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
    } else if (GROUPS.some((g) => groupStageCompleteFor(stateView(), g))) {
      // 有小组已完赛即同步：已确定对手的淘汰赛场次可提前录入
      syncKnockoutInternal()
    }
    persist()
    return { ok: true, match }
  }

  // 判负/延期准入：延期随时可用；判某一方负需该方选手已确定；双方负需双方都确定
  function canJudgeForfeit(match, decision) {
    if (!match) return false
    if (decision === 'extend') return true
    if (decision === 'both') return !!(match.playerAId && match.playerBId)
    if (decision === 'A') return !!match.playerAId
    if (decision === 'B') return !!match.playerBId
    return false
  }

  function forfeitMatch(id, decision) {
    if (guardReadOnly()) return { ok: false, message: '当前赛季已归档，处于只读状态' }
    const match = matches.value.find((m) => m.id === id)
    if (!match) return { ok: false, message: '未找到该场比赛' }
    if (!canJudgeForfeit(match, decision)) {
      // 交给页面层提示：store 不弹窗
      return {
        ok: false,
        message: '对手尚未确定：只能对已确定的选手执行判负，待定一方无法判负或双方负',
      }
    }
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
      addLog(
        `${playerName(match.playerAId)} vs ${playerName(match.playerBId)} 判定 ${labels[decision]}`,
      )
    }
    if (match.stage !== 'group') {
      syncKnockoutInternal()
    } else if (GROUPS.some((g) => groupStageCompleteFor(stateView(), g))) {
      syncKnockoutInternal()
    }
    persist()
    return {
      ok: true,
      message:
        decision === 'extend'
          ? `${playerName(match.playerAId)} vs ${playerName(match.playerBId)} 已恢复待赛`
          : `${playerName(match.playerAId)} vs ${playerName(match.playerBId)} 已判定：${labels[decision]}`,
    }
  }

  function resolveTiebreak(groupId) {
    if (guardReadOnly()) return
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
    if (guardReadOnly()) return null
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
    if (guardReadOnly()) return
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
    const hasKnockout = matches.value.some(
      (m) => m.stage !== 'group' && (m.playerAId || m.playerBId || m.status !== 'pending'),
    )
    const groupsDone = GROUPS.every((g) => groupStageCompleteFor(stateView(), g))
    // 小组赛全部结束后才算进入淘汰赛阶段（提前录入的对阵不改变阶段）
    if (hasKnockout && groupsDone) return 'knockout'
    const hasGroup = players.value.some((p) => p.groupId)
    if (hasGroup) return 'group'
    return 'setup'
  })

  // 淘汰赛当前轮次：第一个尚未全部结束的轮次（八强 → 半决赛 → 决赛）。
  // 不能直接用 stage === 'knockout' 当作八强，否则半决赛、决赛期间首页会一直显示八强。
  const currentKnockoutStage = computed(() => {
    for (const knockoutStage of ['qf', 'sf', 'final']) {
      const round = matches.value.filter((m) => m.stage === knockoutStage)
      if (!round.length) continue
      if (!round.every(isMatchDecided)) return knockoutStage
    }
    return null
  })

  const knockoutMatches = computed(() => {
    const seeds = knockoutSeedMatches(stateView())
    return seeds.map((seed) => {
      const match = matches.value.find((m) => m.stage === seed.stage && m.order === seed.order)
      if (match) {
        const aId = match.playerAId || seed.a || null
        const bId = match.playerBId || seed.b || null
        return {
          ...seed,
          matchId: match.id,
          playerAId: aId,
          playerBId: bId,
          sets: match.sets,
          // 双方尚未确定时显示"预计"，确定后才显示真实状态
          status: match.status === 'pending' && !(aId && bId) ? 'locked' : match.status,
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

  const overdueMatches = computed(() => {
    const current = nowMs.value
    return matches.value
      .filter((m) => {
        if (m.status !== 'pending') return false
        const ddl = ddlForMatch(m)
        return !!ddl && new Date(ddl).getTime() < current
      })
      .map((m) => ({ match: m, ddl: ddlForMatch(m) }))
  })

  const latestResults = computed(() =>
    matches.value
      .filter((m) => m.status === 'complete')
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6),
  )

  // 本地引用，避免 this 问题
  function getStandings(groupId) {
    return getStandingsFor(stateView(), groupId)
  }

  function syncKnockoutInternal() {
    championId.value = syncKnockout(stateView(), persist) ?? null
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
    adminAvatar,
    canJudgeForfeit,
    ready,
    init,
    persist,
    sync,
    mirror,
    seasons,
    currentSeasonId,
    currentSeasonName,
    readOnly,
    loadSeasons,
    loadSeasonPlayers,
    switchSeason,
    createSeason,
    updateSeason,
    setCurrentSeason,
    archiveSeason,
    deleteSeason,
    setCloudWriteEnabled,
    retrySync,
    retryMirror,
    reconnect,
    useRemoteVersion,
    useLocalVersion,
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
    currentKnockoutStage,
    knockoutMatches,
    overdueMatches,
    latestResults,
    getStandings,
    matchScore,
    STAGE_LABELS,
    STATUS_LABELS,
  }
})

export { GROUPS, STAGE_LABELS, STATUS_LABELS, matchScore }
