import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createAuthFetch } from '../src/lib/supabaseFetch.js'

function capture() {
  const calls = []
  const baseFetch = (input, init) => {
    calls.push({ input, init })
    return Promise.resolve({ ok: true })
  }
  return { calls, baseFetch }
}

test('有登录态时带上会话 access_token 与 apikey', async () => {
  const { calls, baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({
    apiKey: 'sb_publishable_test',
    getAccessToken: async () => 'session-token',
    baseFetch,
  })

  await fetchWithAuth('https://example.test/rest/v1/tournament_state', { method: 'PATCH' })

  const headers = calls[0].init.headers
  assert.equal(headers.get('apikey'), 'sb_publishable_test')
  assert.equal(headers.get('Authorization'), 'Bearer session-token')
  assert.equal(calls[0].init.method, 'PATCH')
})

test('没有会话时退回 anon key（游客只读也要能带上 apikey）', async () => {
  const { calls, baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({
    apiKey: 'sb_publishable_test',
    getAccessToken: async () => null,
    baseFetch,
  })

  await fetchWithAuth('https://example.test/rest/v1/tournament_state')

  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer sb_publishable_test')
  assert.equal(calls[0].init.headers.get('apikey'), 'sb_publishable_test')
})

test('每次请求都重新取 token，刷新后立即生效', async () => {
  const tokens = ['first-token', 'second-token']
  let index = 0
  const { calls, baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({
    apiKey: 'key',
    getAccessToken: async () => tokens[index++],
    baseFetch,
  })

  await fetchWithAuth('https://example.test/a')
  await fetchWithAuth('https://example.test/b')

  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer first-token')
  assert.equal(calls[1].init.headers.get('Authorization'), 'Bearer second-token')
})

test('调用方显式给出的头不会被覆盖（与 supabase-js 行为一致）', async () => {
  const { calls, baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({
    apiKey: 'key',
    getAccessToken: async () => 'session-token',
    baseFetch,
  })

  await fetchWithAuth('https://example.test/a', {
    headers: { Authorization: 'Bearer custom', apikey: 'custom-key', 'x-trace': '1' },
    body: 'payload',
  })

  const headers = calls[0].init.headers
  assert.equal(headers.get('Authorization'), 'Bearer custom')
  assert.equal(headers.get('apikey'), 'custom-key')
  assert.equal(headers.get('x-trace'), '1')
  assert.equal(calls[0].init.body, 'payload')
})

test('取 token 失败时向上抛出（与 supabase-js 一致，交给同步层重试）', async () => {
  const { baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({
    apiKey: 'key',
    getAccessToken: async () => {
      throw new Error('refresh failed')
    },
    baseFetch,
  })

  await assert.rejects(() => fetchWithAuth('https://example.test/a'), /refresh failed/)
})

test('未提供 getAccessToken 时只用 anon key', async () => {
  const { calls, baseFetch } = capture()
  const fetchWithAuth = createAuthFetch({ apiKey: 'key', baseFetch })

  await fetchWithAuth('https://example.test/a')

  assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer key')
})
