/**
 * 多表读取：赛季列表、当前赛季与整季数据包。
 *
 * 只在 VITE_DATA_MODEL=multi 时使用；返回的行集交给 seasonSnapshot.rowsToSnapshot
 * 组装成 store 快照。匿名只读（RLS 允许），logs 只有登录后才可见。
 */

const SEASON_FIELDS =
  'id,slug,name,is_current,is_archived,champion_player_id,runner_up_player_id,draft_groups,revision,created_at'

async function read(builder) {
  const { data, error } = await builder
  if (error) throw error
  return data || []
}

/**
 * logs 只对登录的主办方可见：匿名访问会得到 401（表级权限都没有），
 * 这里按「尽力而为」处理，取不到就当空数组，不影响公开页面读取。
 */
async function readOptional(builder) {
  try {
    return await read(builder)
  } catch {
    return []
  }
}

/** 全部赛季（新建在前），用于赛季切换器与归档页 */
export async function fetchSeasons(client) {
  return read(
    client.from('seasons').select(SEASON_FIELDS).order('created_at', { ascending: false }),
  )
}

export async function fetchSeasonById(client, seasonId) {
  const rows = await read(client.from('seasons').select(SEASON_FIELDS).eq('id', seasonId).limit(1))
  return rows[0] || null
}

/**
 * 定位要展示的赛季：优先用本机上次选择（未归档时），否则 is_current，
 * 最后回退到最新一个未归档赛季。
 */
export async function fetchCurrentSeason(client, preferredId = null) {
  if (preferredId) {
    const preferred = await fetchSeasonById(client, preferredId)
    if (preferred && !preferred.is_archived) return preferred
  }

  const current = await read(
    client.from('seasons').select(SEASON_FIELDS).eq('is_current', true).limit(1),
  )
  if (current[0]) return current[0]

  const fallback = await read(
    client
      .from('seasons')
      .select(SEASON_FIELDS)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .limit(1),
  )
  return fallback[0] || null
}

/** 整季数据包：键名与 rowsToSnapshot 的入参一一对应 */
export async function fetchSeasonBundle(client, seasonId) {
  const id = seasonId
  const [season, players, matches, ddlRounds, tiebreaks, draws, evidence, logs] = await Promise.all(
    [
      fetchSeasonById(client, id),
      read(
        client
          .from('players')
          .select('*')
          .eq('season_id', id)
          .order('sort_order', { ascending: true }),
      ),
      read(client.from('matches').select('*').eq('season_id', id)),
      read(client.from('ddl_rounds').select('*').eq('season_id', id)),
      read(client.from('tiebreak_resolutions').select('*').eq('season_id', id)),
      read(client.from('draws').select('*').eq('season_id', id).order('at', { ascending: false })),
      read(
        client
          .from('evidence')
          .select('*')
          .eq('season_id', id)
          .order('created_at', { ascending: false }),
      ),
      readOptional(
        client.from('logs').select('*').eq('season_id', id).order('at', { ascending: false }),
      ),
    ],
  )

  if (!season) throw new Error(`赛季不存在：${id}`)
  return { season, players, matches, ddlRounds, tiebreaks, draws, evidence, logs }
}

/** 一次取回多个赛季的选手名单（归档页展示冠军姓名用） */
export async function fetchSeasonPlayers(client, seasonIds) {
  const ids = (seasonIds || []).filter(Boolean)
  if (!ids.length) return []
  return read(
    client
      .from('players')
      .select('id,season_id,name')
      .in('season_id', ids)
      .order('sort_order', { ascending: true }),
  )
}
