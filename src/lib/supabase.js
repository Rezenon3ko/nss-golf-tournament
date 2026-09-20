import { SUPABASE_URL, SUPABASE_ANON_KEY, USE_SUPABASE } from '@/config'

/**
 * 是否配置了云端（同步判断，不加载任何 SDK 代码）。
 * 用于「本地模式 / 云端模式」这类不需要客户端实例的判断。
 */
export function isSupabaseConfigured() {
  return Boolean(USE_SUPABASE && SUPABASE_URL && SUPABASE_ANON_KEY)
}

/**
 * 按需加载精简版 Supabase 客户端（组装逻辑见 supabaseClient.js）。
 *
 * 用动态 import 是为了把那三个 SDK（合计约 145 KB，gzip 约 37 KB）从首屏入口摘出去：
 * 入口只留 Vue 与业务代码，先渲染界面，SDK 与数据在后台并行加载。
 * 客户端只创建一次，之后复用同一个 Promise。
 */
let clientPromise = null

export function getSupabase() {
  if (!isSupabaseConfigured()) return Promise.resolve(null)
  if (!clientPromise) {
    clientPromise = import('@/lib/supabaseClient')
      .then(({ createSupabaseClient }) => createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY))
      .catch((err) => {
        // 加载失败时清掉缓存的 Promise，下次调用可以重试
        clientPromise = null
        throw err
      })
  }
  return clientPromise
}
