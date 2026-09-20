import { GoTrueClient } from '@supabase/auth-js'
import { PostgrestClient } from '@supabase/postgrest-js'
import { StorageClient } from '@supabase/storage-js'
import { createAuthFetch } from '@/lib/supabaseFetch'

/**
 * 精简版 Supabase 客户端：只组装本项目真正用到的三个子客户端 ——
 * auth（登录态）、PostgREST（读写 tournament_state）、Storage（头像）。
 *
 * 相比 createClient() 不再引入 Realtime / Functions / Phoenix
 * （Realtime 会被无条件构造，约 18 KB gzip 而本项目未使用）。
 *
 * 与 supabase-js 保持一致的关键点：
 * - 同样的会话存储键 `sb-<project-ref>-auth-token`，升级后已登录的会话不会失效；
 * - 同样的请求头注入方式（apikey + 当前 access_token，见 supabaseFetch.js）；
 * - 开启 autoRefreshToken / persistSession，token 过期自动续期。
 *
 * anon(publishable) key 本就设计为公开，可安全放在前端。
 */
export function createSupabaseClient(url, key) {
  if (!url || !key) return null

  const base = new URL(url)
  const projectRef = base.hostname.split('.')[0]

  const auth = new GoTrueClient({
    url: new URL('auth/v1', base).href,
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    storageKey: `sb-${projectRef}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    // 本站只支持账号密码登录，且用的是 hash 路由，无需从 URL 解析会话
    detectSessionInUrl: false,
  })

  const fetchWithAuth = createAuthFetch({
    apiKey: key,
    getAccessToken: async () => {
      const { data } = await auth.getSession()
      return data?.session?.access_token ?? null
    },
  })

  const rest = new PostgrestClient(new URL('rest/v1', base).href, { fetch: fetchWithAuth })
  const storage = new StorageClient(new URL('storage/v1', base).href, {}, fetchWithAuth)

  return {
    auth,
    from: (relation) => rest.from(relation),
    storage,
  }
}
