/**
 * 赛事快照 ↔ 多表行的纯映射（无网络、无依赖，便于单测）。
 *
 * 实体级 camelCase ↔ snake_case 映射在 src/lib/rowMapping.js；本文件负责
 * 「整份快照 ↔ 各表行集合」，前端读取（Phase 2）与迁移脚本共用同一份实现。
 *
 * 快照形状：
 *   { players, draft, matches, ddlRounds, tiebreakResolutions, evidence,
 *     logs, championId, drawHistory, adminAvatar }
 */

import {
  clean,
  ddlToRow,
  drawToRow,
  evidenceToRow,
  logToRow,
  matchToRow,
  normalizeDdl,
  numOrNull,
  playerToRow,
  rowToDdl,
  rowToDraw,
  rowToEvidence,
  rowToLog,
  rowToMatch,
  rowToPlayer,
} from './rowMapping.js'

export { normalizeDdl }

const DDL_KEY_ORDER = ['group1', 'group2', 'group3', 'qf', 'sf', 'final']

const GROUP_ORDER = ['A', 'B', 'C', 'D']
const TIER_KEYS = ['1', '2', '3', '4']

/** 决赛败者为亚军；半区作废时优先取快照里记录的递补亚军 */
export function runnerUpOf(snapshot = {}) {
  const final = (snapshot.matches || []).find((m) => m.stage === 'final')
  if (!final) return null
  if (final.runnerUpId) return final.runnerUpId
  if ((final.status !== 'complete' && final.status !== 'forfeit') || !final.winnerId) return null
  return final.winnerId === final.playerAId ? final.playerBId : final.playerAId
}

/** 旧快照 → 各表待写入的行（PostgREST 直接可用的 snake_case，含 season_id） */
export function snapshotToRows(snapshot = {}, { seasonId, slug, name } = {}) {
  const players = Array.isArray(snapshot.players) ? snapshot.players : []
  const matches = Array.isArray(snapshot.matches) ? snapshot.matches : []
  const ddlRounds = Array.isArray(snapshot.ddlRounds) ? snapshot.ddlRounds : []
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : []
  const logs = Array.isArray(snapshot.logs) ? snapshot.logs : []
  const draws = Array.isArray(snapshot.drawHistory) ? snapshot.drawHistory : []
  const tiebreaks = snapshot.tiebreakResolutions || {}

  return {
    season: clean({
      id: seasonId,
      slug,
      name,
      is_current: true,
      is_archived: false,
      champion_player_id: snapshot.championId ?? null,
      runner_up_player_id: runnerUpOf(snapshot),
      draft_groups: snapshot.draft ?? null,
    }),
    players: players.map((player, index) => ({
      season_id: seasonId,
      ...playerToRow(player, index),
    })),
    matches: matches.map((match) => ({ season_id: seasonId, ...matchToRow(match) })),
    ddlRounds: ddlRounds.map((round) => ({ season_id: seasonId, ...ddlToRow(round) })),
    tiebreaks: GROUP_ORDER.flatMap((groupId) =>
      (tiebreaks[groupId] || []).map((playerId, index) => ({
        season_id: seasonId,
        group_id: groupId,
        player_id: playerId,
        position: index,
      })),
    ),
    draws: draws.map((draw) => ({ season_id: seasonId, ...drawToRow(draw) })),
    evidence: evidence.map((item) => ({ season_id: seasonId, ...evidenceToRow(item) })),
    logs: logs.map((entry) => ({ season_id: seasonId, ...logToRow(entry) })),
  }
}

/** 多表行 → 旧快照形状（用于 --verify 与原文档逐字段对账） */
export function rowsToSnapshot(rows = {}, { adminAvatar = null } = {}) {
  const season = rows.season || {}

  const players = [...(rows.players || [])]
    .sort(
      (a, b) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.id).localeCompare(String(b.id)),
    )
    .map(rowToPlayer)

  const matches = [...(rows.matches || [])]
    .sort(
      (a, b) =>
        String(a.stage).localeCompare(String(b.stage)) ||
        String(a.group_id || '').localeCompare(String(b.group_id || '')) ||
        (a.round ?? 0) - (b.round ?? 0) ||
        (a.bracket_order ?? 0) - (b.bracket_order ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .map(rowToMatch)

  // 半区作废的「递补亚军」存在 seasons.runner_up_player_id（比赛表没有该列），
  // 读回时放回决赛行，保持与旧文档 final.runnerUpId 的行为一致
  if (season.runner_up_player_id) {
    const final = matches.find((match) => match.stage === 'final')
    if (final) final.runnerUpId = season.runner_up_player_id
  }

  const ddlRounds = [...(rows.ddlRounds || [])]
    .sort((a, b) => DDL_KEY_ORDER.indexOf(a.key) - DDL_KEY_ORDER.indexOf(b.key))
    .map(rowToDdl)

  const tiebreakResolutions = {}
  for (const groupId of GROUP_ORDER) {
    const order = (rows.tiebreaks || [])
      .filter((row) => row.group_id === groupId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((row) => row.player_id)
    if (order.length) tiebreakResolutions[groupId] = order
  }

  const drawHistory = [...(rows.draws || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(rowToDraw)

  const evidence = [...(rows.evidence || [])]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(rowToEvidence)

  // 操作日志按时间从新到旧（与单文档模式的 unshift 顺序一致），后台「日志记录」页直接渲染
  const logs = [...(rows.logs || [])]
    .sort(
      (a, b) =>
        new Date(b.at).getTime() - new Date(a.at).getTime() ||
        String(b.id).localeCompare(String(a.id)),
    )
    .map(rowToLog)

  return clean({
    players,
    draft: season.draft_groups ?? null,
    matches,
    ddlRounds,
    tiebreakResolutions,
    evidence,
    logs,
    championId: season.champion_player_id ?? null,
    drawHistory,
    adminAvatar,
  })
}

/**
 * 比赛「最近更新时间」的先后顺序（按 updatedAt 升序，时间相同再按 id）。
 * 迁移必须保留文档里的历史时间，否则「最近赛果」排序会失真；
 * 这里只比顺序、不比绝对时间，因此双写启用后（客户端时间 vs 服务端时间）同样适用。
 */
export function matchUpdateOrder(snapshot = {}) {
  return (snapshot.matches || [])
    .map((match) => ({ id: match.id, time: numOrNull(match.updatedAt) ?? 0 }))
    .sort((a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id)))
    .map((entry) => entry.id)
}

// ---------- 规范化（对账用） ----------
// 旧快照与「表重拼快照」在数组顺序、时间格式上可能不同，
// 统一排序与字段类型后再比较，能区分「真的丢数据」与「只是顺序不同」。

function canonKeyedObject(value, keys) {
  if (!value) return null
  const result = {}
  for (const key of keys) {
    if (value[key] !== undefined && value[key] !== null) result[key] = value[key]
  }
  return result
}

function canonTiebreaks(tiebreaks) {
  const result = {}
  for (const groupId of GROUP_ORDER) {
    const order = tiebreaks?.[groupId]
    if (Array.isArray(order) && order.length) result[groupId] = [...order]
  }
  return result
}

export function canonicalizeSnapshot(snapshot = {}) {
  const canonical = {
    players: (snapshot.players || [])
      .map((player) => playerToRow(player))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    draft: canonKeyedObject(snapshot.draft, GROUP_ORDER),
    matches: (snapshot.matches || [])
      // updated_at 不参与逐字段比较：文档里是客户端时间、表里是服务端时间，
      // 双写启用后两者本来就不会逐毫秒一致；相对顺序另有 matchUpdateOrder 校验。
      .map((match) => {
        const row = matchToRow(match)
        delete row.updated_at
        return row
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    ddlRounds: (snapshot.ddlRounds || [])
      .map((round) => ddlToRow(round))
      .sort((a, b) => DDL_KEY_ORDER.indexOf(a.key) - DDL_KEY_ORDER.indexOf(b.key)),
    tiebreakResolutions: canonTiebreaks(snapshot.tiebreakResolutions),
    evidence: (snapshot.evidence || [])
      .map((item) => evidenceToRow(item))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    logs: (snapshot.logs || [])
      .map((entry) => logToRow(entry))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    championId: snapshot.championId ?? null,
    drawHistory: (snapshot.drawHistory || [])
      .map((draw) => ({
        ...drawToRow(draw),
        tiers: canonKeyedObject(draw.tiers, TIER_KEYS),
        groups: canonKeyedObject(draw.groups, GROUP_ORDER),
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    adminAvatar: snapshot.adminAvatar ?? null,
  }

  return JSON.stringify(canonical)
}

/** 对账：返回 null 表示一致，否则给出首个差异位置附近的内容 */
export function diffCanonical(a, b) {
  if (a === b) return null
  let index = 0
  const limit = Math.min(a.length, b.length)
  while (index < limit && a[index] === b[index]) index += 1
  const context = 80
  return {
    index,
    old: a.slice(Math.max(0, index - context), index + context),
    next: b.slice(Math.max(0, index - context), index + context),
  }
}
