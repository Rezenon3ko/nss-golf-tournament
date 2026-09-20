/**
 * 给 PostgREST / Storage 的请求注入 apikey 与当前登录态。
 *
 * 这是 supabase-js 内部 fetchWithAuth 的等价实现，行为保持一致：
 * 1. 请求头里没有 apikey 时补上项目的 anon(publishable) key；
 * 2. 没有 Authorization 时用「当前会话的 access_token」，没有会话则退回 anon key；
 * 3. 每次请求都重新取一次 token，所以 token 刷新后无需额外处理；
 * 4. 调用方显式给出的 Authorization 不会被覆盖。
 *
 * 单独成模块是为了能脱离 supabase 依赖做单测——这段逻辑错了会导致写入被 RLS 拒绝。
 */
export function createAuthFetch({ apiKey, getAccessToken, baseFetch } = {}) {
  const doFetch = baseFetch || globalThis.fetch

  return async (input, init = {}) => {
    const token = getAccessToken ? await getAccessToken() : null
    const headers = new Headers(init.headers)

    if (apiKey && !headers.has('apikey')) headers.set('apikey', apiKey)
    if (!headers.has('Authorization')) {
      const bearer = token || apiKey
      if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
    }

    return doFetch(input, { ...init, headers })
  }
}
