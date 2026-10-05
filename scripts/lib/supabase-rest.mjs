/**
 * 脚本用的极简 Supabase 客户端：只做登录（auth）与 PostgREST 读写。
 *
 * 不引入 @supabase/* SDK 与 src/ 下的路径别名，保证 `node scripts/xxx.mjs`
 * 在没有 Vite、没有构建步骤的情况下也能直接运行。
 */

import { readFileSync } from 'node:fs'

/** 读取 .env 风格的键值文件；文件不存在时返回空对象 */
export function loadEnvFile(path) {
  const env = {}
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return env
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

/** 账号密码登录，返回 { accessToken, userId, email } */
export async function signIn({ url, apiKey, email, password }) {
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token) {
    const reason = data?.error_description || data?.msg || data?.error || `${response.status}`
    throw new Error(`登录失败：${reason}`)
  }
  return {
    accessToken: data.access_token,
    userId: data.user?.id || null,
    email: data.user?.email || email,
  }
}

/** 带 apikey / 登录态的 PostgREST 客户端 */
export function createRest({ url, apiKey, accessToken }) {
  async function request(path, { method = 'GET', body, prefer } = {}) {
    const headers = {
      apikey: apiKey,
      Authorization: `Bearer ${accessToken || apiKey}`,
      'Content-Type': 'application/json',
    }
    if (prefer) headers.Prefer = prefer

    const response = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let data = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }
    if (!response.ok) {
      const message = data?.message || data?.hint || text || `${response.status}`
      const error = new Error(`请求失败（${response.status}）：${message}`)
      error.status = response.status
      error.code = data?.code
      throw error
    }
    return data
  }

  return {
    request,
    get: (path) => request(path),
    post: (path, body, options = {}) =>
      request(path, { method: 'POST', body, prefer: options.prefer }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
  }
}

/**
 * 批量 upsert。PostgREST 要求同一批的键集合一致，
 * 这里取并集并给缺失字段补 null（全部行都缺的键直接省略，交给数据库默认值）。
 */
export async function bulkUpsert(rest, table, rows, onConflict) {
  if (!rows.length) return 0
  const keys = new Set()
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key)
  }
  const unified = rows.map((row) => {
    const next = {}
    for (const key of keys) next[key] = row[key] === undefined ? null : row[key]
    return next
  })
  const path = onConflict ? `${table}?on_conflict=${onConflict}` : table
  await rest.post(path, unified, { prefer: 'resolution=merge-duplicates,return=minimal' })
  return rows.length
}
