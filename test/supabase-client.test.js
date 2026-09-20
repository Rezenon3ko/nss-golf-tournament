import { test } from 'node:test'
import assert from 'node:assert/strict'

// 相对路径导入，绕开测试替身，验证真实客户端的组装结果
const { createSupabaseClient } = await import('../src/lib/supabaseClient.js')
const { getSupabase, isSupabaseConfigured } = await import('../src/lib/supabase.js')

test('缺少 url 或 key 时返回 null（本地模式）', () => {
  assert.equal(createSupabaseClient('', 'key'), null)
  assert.equal(createSupabaseClient('https://x.supabase.co', ''), null)
  assert.equal(createSupabaseClient(), null)
})

test('会话存储键与 supabase-js 一致，升级后已登录会话不失效', () => {
  const client = createSupabaseClient('https://abcdefghijklm.supabase.co', 'sb_publishable_test')

  // supabase-js 的默认键：sb-<project-ref>-auth-token
  assert.equal(client.auth.storageKey, 'sb-abcdefghijklm-auth-token')
})

test('只暴露本项目使用的三个入口：auth / from / storage', () => {
  const client = createSupabaseClient('https://abcdefghijklm.supabase.co', 'sb_publishable_test')

  assert.equal(typeof client.auth.signInWithPassword, 'function')
  assert.equal(typeof client.auth.getSession, 'function')
  assert.equal(typeof client.auth.signOut, 'function')
  assert.equal(typeof client.from, 'function')
  assert.equal(typeof client.storage.from, 'function')
  // 未使用的部分不应存在（精简的意义所在）
  assert.equal(client.realtime, undefined)
  assert.equal(client.functions, undefined)
})

test('访问器按需加载客户端：只创建一次，未配置时返回 null', async () => {
  assert.equal(isSupabaseConfigured(), true)

  const [first, second] = await Promise.all([getSupabase(), getSupabase()])
  assert.ok(first, '应返回客户端实例')
  assert.equal(first, second, '并发调用复用同一个 Promise，不会重复创建')

  const third = await getSupabase()
  assert.equal(third, first, '后续调用复用同一实例')
})

test('from() / storage.from() 返回可链式调用的 builder', () => {
  const client = createSupabaseClient('https://abcdefghijklm.supabase.co', 'sb_publishable_test')

  const query = client.from('tournament_state')
  assert.equal(typeof query.select, 'function')
  assert.equal(typeof query.update, 'function')
  assert.equal(typeof query.upsert, 'function')

  const bucket = client.storage.from('avatars')
  assert.equal(typeof bucket.upload, 'function')
  assert.equal(typeof bucket.getPublicUrl, 'function')
  assert.equal(typeof bucket.remove, 'function')
})
