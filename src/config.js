const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}

export const SUPABASE_URL = String(env.VITE_SUPABASE_URL || '')
export const SUPABASE_ANON_KEY = String(env.VITE_SUPABASE_ANON_KEY || '')
export const USE_SUPABASE = env.VITE_USE_SUPABASE === 'true'
export const ADMIN_EMAIL = String(env.VITE_ADMIN_EMAIL || 'admin@nss.local')

export const siteName = '鬼吃鱼高尔夫锦标赛'

// 本地回退模式的主办方口令：通过 .env 的 VITE_ADMIN_PASSWORD 提供（不提交到仓库）。
// 启用 Supabase 后登录改用 Supabase 主办方账号密码，此处不再使用。
export const ADMIN_PASSWORD = String(env.VITE_ADMIN_PASSWORD || '')

// 会话有效期（毫秒），默认 7 天
export const AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const AUTH_STORAGE_KEY = 'ghostfish.auth'
export const TOURNAMENT_STORAGE_KEY = 'ghostfish.tournament.v8'
