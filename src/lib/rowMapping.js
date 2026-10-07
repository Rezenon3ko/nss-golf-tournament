/**
 * 赛事实体在「前端对象（camelCase）」与「数据表行（snake_case）」之间的纯映射。
 *
 * 迁移脚本（src/lib/seasonSnapshot.js）与前端双写 / 读取共用这一份实现，
 * 避免两处口径漂移；所有函数都不依赖 Vue / Supabase。
 */

export function clean(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))
}

export function numOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function msToIso(value) {
  const ms = numOrNull(value)
  return ms === null ? null : new Date(ms).toISOString()
}

function isoToMs(value) {
  if (value === null || value === undefined || value === '') return null
  const ms = new Date(String(value).replace(' ', 'T')).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** 把 DDL 统一成「YYYY-MM-DDTHH:mm」（墙上时间，不带时区） */
export function normalizeDdl(value) {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

// ---------- 选手 ----------

/** sortOrder 只在明确知道名单位置时传入（迁移与镜像同步都会传） */
export function playerToRow(player, sortOrder) {
  return clean({
    id: player.id,
    name: player.name,
    tier: numOrNull(player.tier) ?? 4,
    group_id: player.groupId ?? null,
    best_score: numOrNull(player.bestScore),
    avatar_url: player.avatar ?? null,
    sort_order: numOrNull(sortOrder) ?? undefined,
  })
}

export function rowToPlayer(row) {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar_url ?? null,
    bestScore: numOrNull(row.best_score),
    tier: numOrNull(row.tier) ?? 4,
    groupId: row.group_id ?? null,
  }
}

// ---------- 比赛 ----------

export function matchToRow(match) {
  return clean({
    id: match.id,
    stage: match.stage,
    group_id: match.groupId ?? null,
    round: numOrNull(match.round),
    bracket_order: numOrNull(match.order),
    label: match.label ?? null,
    player_a_id: match.playerAId ?? null,
    player_b_id: match.playerBId ?? null,
    status: match.status,
    forfeit_by: match.forfeitBy ?? null,
    winner_id: match.winnerId ?? null,
    walkover_note: match.walkover ?? null,
    sets: Array.isArray(match.sets) ? match.sets : [],
    disconnect: match.disconnect ?? null,
    result_links: Array.isArray(match.resultLinks) ? match.resultLinks : [],
    log: Array.isArray(match.log) ? match.log : [],
    created_at: msToIso(match.createdAt) ?? undefined,
    updated_at: msToIso(match.updatedAt) ?? undefined,
  })
}

export function rowToMatch(row) {
  return clean({
    id: row.id,
    stage: row.stage,
    groupId: row.group_id ?? null,
    round: row.round ?? null,
    order: row.bracket_order ?? null,
    playerAId: row.player_a_id ?? null,
    playerBId: row.player_b_id ?? null,
    sets: row.sets ?? [],
    status: row.status,
    forfeitBy: row.forfeit_by ?? null,
    winnerId: row.winner_id ?? null,
    resultLinks: row.result_links ?? [],
    disconnect: row.disconnect ?? null,
    log: row.log ?? [],
    walkover: row.walkover_note ?? undefined,
    createdAt: isoToMs(row.created_at),
    updatedAt: isoToMs(row.updated_at),
  })
}

// ---------- DDL 轮次 ----------

export function ddlToRow(round) {
  return {
    key: round.key,
    label: round.label,
    stage: round.stage,
    round: numOrNull(round.round),
    ddl: normalizeDdl(round.ddl),
  }
}

export function rowToDdl(row) {
  return {
    key: row.key,
    label: row.label,
    stage: row.stage,
    round: row.round ?? null,
    ddl: normalizeDdl(row.ddl),
  }
}

// ---------- 证据 ----------

export function evidenceToRow(item) {
  return clean({
    id: item.id,
    match_id: item.matchId ?? null,
    type: item.type ?? 'other',
    name: item.name ?? '未命名证据',
    url: item.url,
    by_name: item.by ?? null,
    created_at: msToIso(item.time) ?? undefined,
  })
}

export function rowToEvidence(row) {
  return {
    id: row.id,
    matchId: row.match_id ?? null,
    type: row.type ?? 'other',
    url: row.url,
    name: row.name ?? '未命名证据',
    by: row.by_name ?? null,
    time: isoToMs(row.created_at),
  }
}

// ---------- 抽签记录 ----------

export function drawToRow(draw) {
  return clean({
    id: draw.id,
    at: msToIso(draw.time) ?? undefined,
    by_name: draw.by ?? null,
    tiers: draw.tiers ?? null,
    groups: draw.groups ?? null,
  })
}

export function rowToDraw(row) {
  return {
    id: row.id,
    time: isoToMs(row.at),
    by: row.by_name ?? null,
    tiers: row.tiers ?? null,
    groups: row.groups ?? null,
  }
}

// ---------- 操作日志 ----------

export function logToRow(entry) {
  return clean({
    id: entry.id,
    at: msToIso(entry.time) ?? undefined,
    by_name: entry.by ?? null,
    message: entry.message,
  })
}

export function rowToLog(row) {
  return {
    id: row.id,
    time: isoToMs(row.at),
    by: row.by_name ?? null,
    message: row.message ?? null,
  }
}
