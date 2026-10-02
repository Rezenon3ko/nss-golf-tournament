/**
 * 后台数据统计的纯函数实现（不依赖 Vue / Pinia，便于单测）。
 *
 * 两项统计：
 * 1. SD（突然死亡）胜场：单局 9 洞打成平局即进入 SD，由 sdWinner 标记该局归属；
 * 2. PB 突破：选手报名时填的历史最佳（bestScore）与本次比赛的每局成绩同量纲
 *    （都是相对标准杆，如 -16），因此某局成绩严格优于报名 PB 即算一次突破。
 *
 * 未记录成绩的局（未开赛 / 判负 / 轮空）与缺字段的脏数据一律跳过，不参与统计。
 */

function setScoreFor(set, match, playerId) {
  if (!set) return null
  if (match.playerAId === playerId) return set.a ?? null
  if (match.playerBId === playerId) return set.b ?? null
  return null
}

function matchRef(match) {
  return {
    matchId: match.id,
    stage: match.stage,
    groupId: match.groupId ?? null,
    round: match.round ?? null,
    order: match.order ?? null,
  }
}

/**
 * SD 胜场榜。
 * @returns {{ rows: Array, totalSd: number, undecided: number }}
 *   按 胜场数 → 胜率 → 局数 → 姓名排序（胜率 = 胜场 / 局数）
 */
export function buildSdStats({ matches = [], players = [] } = {}) {
  const rowsById = new Map(
    players.map((player) => [
      player.id,
      { playerId: player.id, name: player.name, wins: 0, played: 0, details: [] },
    ]),
  )
  let totalSd = 0
  let undecided = 0

  for (const match of matches) {
    const sets = Array.isArray(match.sets) ? match.sets : []
    sets.forEach((set, setIndex) => {
      // 只有双方都记了杆数且打平，才说明这一局进了 SD
      if (set?.a == null || set?.b == null || set.a !== set.b) return
      totalSd += 1

      const aRow = rowsById.get(match.playerAId)
      const bRow = rowsById.get(match.playerBId)
      if (aRow) aRow.played += 1
      if (bRow) bRow.played += 1

      const winnerId = set.sdWinner || null
      if (!winnerId) {
        undecided += 1
        return
      }
      const winnerRow = rowsById.get(winnerId)
      if (!winnerRow) return
      const opponentId = winnerId === match.playerAId ? match.playerBId : match.playerAId
      winnerRow.wins += 1
      winnerRow.details.push({ ...matchRef(match), setIndex, score: set.a, opponentId })
    })
  }

  const rows = [...rowsById.values()]
    .filter((row) => row.played > 0)
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.wins / b.played - a.wins / a.played ||
        b.played - a.played ||
        String(a.name).localeCompare(String(b.name), 'zh'),
    )

  return { rows, totalSd, undecided }
}

/**
 * PB 突破榜：统计每局成绩严格优于报名 PB 的次数。
 * @returns {{ rows: Array, missingPb: Array, totalBreaks: number }}
 *   rows 按突破次数 → 最大突破幅度 → 姓名排序
 */
export function buildPbStats({ matches = [], players = [] } = {}) {
  const rows = []
  const missingPb = []
  let totalBreaks = 0

  for (const player of players) {
    const pbRaw = player.bestScore
    const pb = Number(pbRaw)
    if (pbRaw === null || pbRaw === undefined || pbRaw === '' || !Number.isFinite(pb)) {
      missingPb.push({ playerId: player.id, name: player.name })
      continue
    }

    const breaks = []
    for (const match of matches) {
      if (match.playerAId !== player.id && match.playerBId !== player.id) continue
      const sets = Array.isArray(match.sets) ? match.sets : []
      sets.forEach((set, setIndex) => {
        const raw = setScoreFor(set, match, player.id)
        const score = Number(raw)
        if (raw === null || raw === undefined || !Number.isFinite(score)) return
        if (score >= pb) return
        const opponentId = match.playerAId === player.id ? match.playerBId : match.playerAId
        breaks.push({
          ...matchRef(match),
          setIndex,
          score,
          pb,
          delta: score - pb, // 负数，越小表示突破幅度越大
          opponentId,
        })
      })
    }

    if (!breaks.length) continue
    totalBreaks += breaks.length
    breaks.sort((a, b) => a.delta - b.delta || a.setIndex - b.setIndex)
    rows.push({
      playerId: player.id,
      name: player.name,
      pb,
      count: breaks.length,
      bestDelta: breaks[0].delta,
      bestScore: breaks[0].score,
      breaks,
    })
  }

  rows.sort(
    (a, b) =>
      b.count - a.count ||
      a.bestDelta - b.bestDelta ||
      String(a.name).localeCompare(String(b.name), 'zh'),
  )

  return { rows, missingPb, totalBreaks }
}
