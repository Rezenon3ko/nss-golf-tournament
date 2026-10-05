/**
 * 把 Realtime 的 postgres_changes 事件合并进 store 的可变切片（Vue 响应式数组）。
 *
 * 纯函数、无网络依赖，便于单测。合并按「行内容」判断是否有变化：
 * 自己写入的回声与本地内容一致时直接跳过，避免无谓的响应式刷新。
 */

import { rowToDdl, rowToEvidence, rowToMatch, rowToPlayer } from '@/lib/rowMapping'

function hasSameContent(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function applyRowChange(list, change, mapRow) {
  const row = change.eventType === 'DELETE' ? change.old : change.new
  if (!row) return false
  const index = list.findIndex((item) => item.id === row.id)

  if (change.eventType === 'DELETE') {
    if (index === -1) return false
    list.splice(index, 1)
    return true
  }

  const mapped = mapRow(row)
  if (index === -1) {
    list.push(mapped)
    return true
  }
  // 半区作废的递补亚军不在比赛表里，保留本地已有的 runnerUpId
  if (mapped.stage === 'final' || list[index].runnerUpId) {
    if (list[index].runnerUpId) mapped.runnerUpId = list[index].runnerUpId
  }
  if (hasSameContent(list[index], mapped)) return false
  list.splice(index, 1, mapped)
  return true
}

function applyKeyedChange(list, change, mapRow, keyOf) {
  const row = change.eventType === 'DELETE' ? change.old : change.new
  if (!row) return false
  const key = keyOf(row)
  const index = list.findIndex((item) => keyOf(item) === key)

  if (change.eventType === 'DELETE') {
    if (index === -1) return false
    list.splice(index, 1)
    return true
  }

  const mapped = mapRow(row)
  if (index === -1) {
    list.push(mapped)
    return true
  }
  if (hasSameContent(list[index], mapped)) return false
  list.splice(index, 1, mapped)
  return true
}

/**
 * @param slices {{ players: Array, matches: Array, ddlRounds: Array, evidence: Array }}
 * @param changes {{ table: string, eventType: string, new?: object, old?: object }[]}
 * @returns {{ changed: boolean, tiebreakRefetch: boolean, season: object|null }}
 */
export function applyRealtimeChanges(slices, changes) {
  const result = { changed: false, tiebreakRefetch: false, season: null }

  for (const change of changes) {
    switch (change.table) {
      case 'players':
        result.changed = applyRowChange(slices.players, change, rowToPlayer) || result.changed
        break
      case 'matches':
        result.changed = applyRowChange(slices.matches, change, rowToMatch) || result.changed
        break
      case 'ddl_rounds':
        result.changed =
          applyKeyedChange(slices.ddlRounds, change, rowToDdl, (row) => row.key) || result.changed
        break
      case 'evidence':
        result.changed = applyRowChange(slices.evidence, change, rowToEvidence) || result.changed
        break
      case 'tiebreak_resolutions':
        // 抽签解决记录是「整组替换」语义，直接标记为该表重新拉取
        result.tiebreakRefetch = true
        result.changed = true
        break
      case 'seasons':
        if (change.eventType !== 'DELETE' && change.new) {
          result.season = change.new
          result.changed = true
        }
        break
      default:
        break
    }
  }

  return result
}
