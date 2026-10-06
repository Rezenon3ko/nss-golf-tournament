/**
 * 多表写入的仓储层：把 store 的领域对象映射成 RPC 参数。
 *
 * 只依赖传进来的 Supabase 客户端（需要 client.rpc），不直接读全局状态，
 * 便于在测试里用假客户端断言「调用了哪个函数、传了什么参数」。
 */

import { drawToRow, evidenceToRow, logToRow, matchToRow, playerToRow } from '@/lib/rowMapping'

export function createRepository(client, seasonId) {
  async function call(fn, params) {
    const { data, error } = await client.rpc(fn, params)
    if (error) throw error
    return data
  }

  return {
    seasonId,

    upsertPlayer(player, sortOrder) {
      return call('upsert_player', {
        p_season_id: seasonId,
        p_player: playerToRow(player, sortOrder),
      })
    },

    deletePlayer(playerId) {
      return call('delete_player', { p_season_id: seasonId, p_player_id: playerId })
    },

    saveDraft(draft) {
      return call('save_draft_groups', { p_season_id: seasonId, p_draft: draft ?? null })
    },

    setDdl(round) {
      return call('set_ddl', {
        p_season_id: seasonId,
        p_key: round.key,
        p_ddl: round.ddl ?? null,
      })
    },

    publishGroups({ players = [], matches = [] }) {
      return call('publish_groups', {
        p_season_id: seasonId,
        p_players: players.map((player) => ({
          id: player.id,
          group_id: player.groupId ?? null,
        })),
        p_matches: matches.map(matchToRow),
      })
    },

    applyChangeset({ matches = [], seasonPatch = null }) {
      return call('apply_match_changeset', {
        p_season_id: seasonId,
        p_matches: matches.map(matchToRow),
        p_season_patch: seasonPatch,
      })
    },

    saveTiebreaks(rows) {
      return call('save_tiebreaks', { p_season_id: seasonId, p_tiebreaks: rows })
    },

    applyEvidence({ op, evidence = null, id = null }) {
      return call('apply_evidence', {
        p_season_id: seasonId,
        p_op: op,
        p_evidence: evidence ? evidenceToRow(evidence) : null,
        p_evidence_id: id,
      })
    },

    appendLogs(logs) {
      return call('append_logs', { p_season_id: seasonId, p_logs: logs.map(logToRow) })
    },

    appendDraw(draw) {
      return call('append_draw', { p_season_id: seasonId, p_draw: drawToRow(draw) })
    },

    resetSeason() {
      return call('reset_season', { p_season_id: seasonId })
    },

    setAdminAvatar(avatarUrl) {
      return call('set_admin_avatar', { p_avatar_url: avatarUrl ?? null })
    },
  }
}

/**
 * 赛季管理（不绑定单个赛季）：新建 / 改名 / 设为当前 / 归档。
 * 参数名与 supabase/rpc-v2.sql 中的函数签名一一对应。
 */
export function createSeasonRepository(client) {
  async function call(fn, params) {
    const { data, error } = await client.rpc(fn, params)
    if (error) throw error
    return data
  }

  return {
    create({ name, slug, copyFrom = null }) {
      return call('create_season', { p_name: name, p_slug: slug, p_copy_from: copyFrom })
    },
    update(seasonId, { name = null, slug = null }) {
      return call('update_season', { p_season_id: seasonId, p_name: name, p_slug: slug })
    },
    setCurrent(seasonId) {
      return call('set_current_season', { p_season_id: seasonId })
    },
    archive(seasonId, archived = true) {
      return call('archive_season', { p_season_id: seasonId, p_archived: archived })
    },
    remove(seasonId) {
      return call('delete_season', { p_season_id: seasonId })
    },
  }
}
