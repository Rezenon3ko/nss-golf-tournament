import { test } from 'node:test'
import assert from 'node:assert/strict'

const { backend } = await import('./fixtures/supabase-stub.js')
const { avatarPathFromUrl, avatarStorageEnabled, removeAvatarByUrl, uploadAvatar } =
  await import('../src/lib/avatars.js')

function reset({ disableStorage = false } = {}) {
  backend.reset({ disableStorage })
}

test('配置了 Supabase 时头像走 Storage', () => {
  reset()
  assert.equal(avatarStorageEnabled(), true)
})

test('未配置 Storage 时不上传，交由调用方回退 dataURL', async () => {
  reset({ disableStorage: true })
  assert.equal(avatarStorageEnabled(), false)
  assert.equal(await uploadAvatar({ type: 'image/jpeg' }, { id: 'p1' }), null)
  assert.equal(backend.storageUploads.length, 0)
})

test('上传头像：路径带 owner 与时间戳，长缓存、不覆盖已有对象', async () => {
  reset()
  const blob = { type: 'image/jpeg', size: 15000 }

  const url = await uploadAvatar(blob, { id: 'p1' })

  assert.equal(backend.storageUploads.length, 1)
  const [{ bucket, path, options }] = backend.storageUploads
  assert.equal(bucket, 'avatars')
  assert.match(path, /^p1-\d+\.jpg$/)
  assert.equal(options.contentType, 'image/jpeg')
  assert.equal(options.cacheControl, '31536000')
  assert.equal(options.upsert, false)
  assert.equal(url, `https://stub.supabase.local/storage/v1/object/public/avatars/${path}`)
})

test('未指定选手 id 时用 player 占位，路径仍然安全', async () => {
  reset()
  await uploadAvatar({ type: 'image/jpeg' }, {})
  assert.match(backend.storageUploads[0].path, /^player-\d+\.jpg$/)
})

test('上传失败会抛出带原因的异常，调用方据此提示用户', async () => {
  reset()
  backend.writeError = { message: 'Bucket not found' }
  await assert.rejects(() => uploadAvatar({ type: 'image/jpeg' }, { id: 'p1' }), /Bucket not found/)
})

test('公开 URL 能反推出对象路径', () => {
  const url = 'https://x.supabase.co/storage/v1/object/public/avatars/p3-1700000000000.jpg'
  assert.equal(avatarPathFromUrl(url), 'p3-1700000000000.jpg')
  assert.equal(avatarPathFromUrl(`${url}?v=2`), 'p3-1700000000000.jpg')
  assert.equal(avatarPathFromUrl('data:image/jpeg;base64,AAAA'), null)
  assert.equal(avatarPathFromUrl('https://example.com/other/p1.jpg'), null)
  assert.equal(avatarPathFromUrl(''), null)
})

test('删除选手时按 URL 清理 Storage 对象；dataURL 或无 Storage 时不动', async () => {
  reset()
  const url = 'https://x.supabase.co/storage/v1/object/public/avatars/p3-1700000000000.jpg'
  assert.equal(await removeAvatarByUrl(url), true)
  assert.deepEqual(backend.storageRemoves[0], {
    bucket: 'avatars',
    paths: ['p3-1700000000000.jpg'],
  })

  assert.equal(await removeAvatarByUrl('data:image/jpeg;base64,AAAA'), false)
  assert.equal(backend.storageRemoves.length, 1)

  reset({ disableStorage: true })
  assert.equal(await removeAvatarByUrl(url), false)
})
