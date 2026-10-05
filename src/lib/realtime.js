/**
 * 观众端实时订阅（Supabase Realtime / postgres_changes）。
 *
 * 只在 VITE_DATA_MODEL=multi 时按需加载 @supabase/realtime-js（独立 chunk），
 * 订阅当前赛季的 6 张公开表，事件按 ~120ms 批量交给回调合并。
 * 断线由 phoenix 自动重连；重新订阅成功时通过 onStatus 通知调用方做全量补偿。
 */

export const REALTIME_TABLES = [
  'seasons',
  'players',
  'matches',
  'ddl_rounds',
  'tiebreak_resolutions',
  'evidence',
]

/** 合并同一批事件，减少高频写入时的渲染次数 */
export function createEventBatcher(handler, delay = 120) {
  let queue = []
  let timer = null

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!queue.length) return
    const batch = queue
    queue = []
    handler(batch)
  }

  return {
    push(event) {
      queue.push(event)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        const batch = queue
        queue = []
        handler(batch)
      }, delay)
      // Node 环境下不阻塞进程退出（浏览器里 setTimeout 返回数字）
      if (timer && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref()
    },
    flush,
  }
}

/**
 * @returns 一个带 close() 的订阅句柄
 */
export async function createRealtimeWatcher({ url, apiKey, seasonId, onChanges, onStatus }) {
  const { RealtimeClient } = await import('@supabase/realtime-js')
  const base = String(url).replace(/^http/, 'ws').replace(/\/+$/, '')
  const client = new RealtimeClient(`${base}/realtime/v1`, { params: { apikey: apiKey } })
  const batcher = createEventBatcher(onChanges)
  const channel = client.channel(`season:${seasonId}`)

  for (const table of REALTIME_TABLES) {
    const filter = table === 'seasons' ? `id=eq.${seasonId}` : `season_id=eq.${seasonId}`
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (payload) => {
      batcher.push({
        table,
        eventType: payload.eventType,
        new: payload.new,
        old: payload.old,
      })
    })
  }

  let hadError = false
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      onStatus({ status: 'subscribed', resubscribed: hadError })
      hadError = false
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      hadError = true
      onStatus({ status: 'error', detail: status })
    } else if (status === 'CLOSED') {
      onStatus({ status: 'closed' })
    }
  })

  return {
    close() {
      batcher.flush()
      return client.removeChannel(channel).catch(() => {})
    },
  }
}
