// 测试用配置：默认开启 Supabase 模式（TEST_LOCAL_MODE=1 时模拟「未配置云端」）
export const USE_SUPABASE = process.env.TEST_LOCAL_MODE !== '1'
// 测试里默认走旧的单文档模式；需要验证双写时可用 TEST_DATA_MODEL=multi 覆盖
export const DATA_MODEL = process.env.TEST_DATA_MODEL === 'multi' ? 'multi' : 'doc'
export const TOURNAMENT_STORAGE_KEY = 'test.tournament'
export const SUPABASE_URL = 'https://stub.supabase.local'
export const SUPABASE_ANON_KEY = 'stub-anon-key'
export const ADMIN_EMAIL = 'admin@nss.local'
export const ADMIN_PASSWORD = ''
export const AUTH_TTL_MS = 1000
export const AUTH_STORAGE_KEY = 'test.auth'
