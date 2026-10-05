/**
 * 数据统计与导出页「复制最终比赛结果（群聊分享）」的文案生成（纯函数，便于单测）。
 *
 * 名次口径（越靠前的名次不再在后面重复出现）：
 * - 冠军 / 亚军：由 store 的 championId / runnerUpId 给出（含判负、半区作废等递补情形）；
 * - 四强：半决赛上场选手去掉冠亚军（即半决赛告负的两人）；
 * - 八强：八强赛上场选手去掉冠亚军与四强（即八强赛告负的四人）。
 *
 * 隐藏奖与数据统计页同一口径（见 src/lib/stats.js），并列时全部列出：
 * - SD 之王：SD 胜场最多；
 * - PB 之星：单局成绩优于报名 PB 的次数最多。
 */

import { buildPbStats, buildSdStats } from '@/lib/stats'

const UNDECIDED = '（未决出）'

function joinedNames(names) {
  return names.length ? names.join('、') : UNDECIDED
}

function topRows(rows, valueOf) {
  const max = rows.reduce((acc, row) => Math.max(acc, valueOf(row)), 0)
  if (max <= 0) return []
  return rows.filter((row) => valueOf(row) === max)
}

function awardText(rows, valueOf, unit) {
  if (!rows.length) return null
  const names = rows.map((row) => row.name).filter(Boolean)
  if (!names.length) return null
  const value = valueOf(rows[0])
  return names.length > 1
    ? `${names.join('、')}（各 ${value} ${unit}）`
    : `${names[0]}（${value} ${unit}）`
}

export function buildFinalResultText({
  siteName = '',
  players = [],
  matches = [],
  knockoutMatches = [],
  championId = null,
  runnerUpId = null,
} = {}) {
  const nameById = new Map(players.map((player) => [player.id, player.name]))
  const nameOf = (id) => (id != null && nameById.has(id) ? nameById.get(id) : null)

  const stageParticipants = (stage) => {
    const names = []
    for (const match of knockoutMatches) {
      if (match.stage !== stage) continue
      for (const id of [match.playerAId, match.playerBId]) {
        const name = nameOf(id)
        if (name && !names.includes(name)) names.push(name)
      }
    }
    return names
  }

  // 越靠前的名次不在后面重复：四强去掉冠亚军，八强再去掉四强
  const champion = nameOf(championId)
  const runnerUp = nameOf(runnerUpId)
  const excluded = new Set([champion, runnerUp].filter(Boolean))
  const semifinalists = stageParticipants('sf')
  const four = semifinalists.filter((name) => !excluded.has(name))
  const eight = stageParticipants('qf').filter(
    (name) => !excluded.has(name) && !semifinalists.includes(name),
  )

  const sd = buildSdStats({ matches, players })
  const pb = buildPbStats({ matches, players })
  const sdKings = topRows(sd.rows, (row) => row.wins)
  const pbStars = topRows(pb.rows, (row) => row.count)

  return [
    `${siteName ? `${siteName} · ` : ''}最终结果`,
    '',
    `🏆 冠军：${nameOf(championId) ?? UNDECIDED}`,
    `🥈 亚军：${nameOf(runnerUpId) ?? UNDECIDED}`,
    '',
    `四强：${joinedNames(four)}`,
    `八强：${joinedNames(eight)}`,
    '',
    '—— 隐藏奖 ——',
    `SD 之王（SD 胜场最多）：${
      awardText(sdKings, (row) => row.wins, '胜') ?? '（本届没有 SD 或未记录胜者）'
    }`,
    `PB 之星（PB 突破最多）：${
      awardText(pbStars, (row) => row.count, '次') ?? '（本届无人突破 PB）'
    }`,
  ].join('\n')
}
