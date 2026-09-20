import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifySyncError,
  createConflictError,
  isDuplicateKey,
  isMissingRevisionColumn,
  nextRetryDelay,
} from '../src/lib/sync.js'

test('nextRetryDelay 指数退避并封顶 30s', () => {
  assert.equal(nextRetryDelay(1), 1000)
  assert.equal(nextRetryDelay(2), 2000)
  assert.equal(nextRetryDelay(3), 4000)
  assert.equal(nextRetryDelay(5), 16000)
  assert.equal(nextRetryDelay(6), 30000)
  assert.equal(nextRetryDelay(20), 30000)
})

test('nextRetryDelay 对非法入参回退到首次等待', () => {
  assert.equal(nextRetryDelay(0), 1000)
  assert.equal(nextRetryDelay(-3), 1000)
  assert.equal(nextRetryDelay(undefined), 1000)
})

test('isMissingRevisionColumn 识别老库缺列', () => {
  assert.equal(isMissingRevisionColumn({ code: '42703' }), true)
  assert.equal(
    isMissingRevisionColumn({
      message: 'column tournament_state.revision does not exist',
    }),
    true,
  )
  assert.equal(isMissingRevisionColumn({ message: 'other error' }), false)
  assert.equal(isMissingRevisionColumn(null), false)
})

test('isDuplicateKey 识别并发插入冲突', () => {
  assert.equal(isDuplicateKey({ code: '23505' }), true)
  assert.equal(isDuplicateKey({ message: 'duplicate key value violates unique constraint' }), true)
  assert.equal(isDuplicateKey({ message: 'boom' }), false)
})

test('createConflictError 携带云端快照', () => {
  const remote = { value: { players: [] }, revision: 7 }
  const error = createConflictError(remote)
  assert.equal(error.isConflict, true)
  assert.deepEqual(error.remote, remote)
})

test('classifySyncError 区分登录过期 / 无权限 / 网络异常 / 其他', () => {
  assert.equal(classifySyncError({ status: 401, message: 'nope' }).kind, 'auth')
  assert.equal(classifySyncError({ message: 'JWT expired' }).kind, 'auth')
  assert.equal(
    classifySyncError({ code: '42501', message: 'new row violates row-level security policy' })
      .kind,
    'forbidden',
  )
  assert.equal(classifySyncError(new TypeError('Failed to fetch')).kind, 'network')
  assert.equal(classifySyncError({ message: 'fetch failed' }).kind, 'network')

  const other = classifySyncError({ message: 'unexpected' })
  assert.equal(other.kind, 'unknown')
  assert.match(other.message, /unexpected/)

  const empty = classifySyncError(null)
  assert.equal(empty.kind, 'unknown')
  assert.ok(empty.message.length > 0)
})
