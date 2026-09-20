import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

const { useFeedbackStore } = await import('../src/stores/feedback.js')

function freshStore() {
  setActivePinia(createPinia())
  return useFeedbackStore()
}

test('notify 入队并可手动关闭', () => {
  const feedback = freshStore()

  const id = feedback.notify('已保存', 'success', { timeout: 0 })
  assert.equal(feedback.toasts.length, 1)
  assert.equal(feedback.toasts[0].message, '已保存')
  assert.equal(feedback.toasts[0].type, 'success')

  feedback.dismiss(id)
  assert.equal(feedback.toasts.length, 0)
})

test('notify 忽略空内容，最多同时保留 3 条', () => {
  const feedback = freshStore()

  assert.equal(feedback.notify('   ', 'info', { timeout: 0 }), null)
  assert.equal(feedback.toasts.length, 0)

  for (const text of ['一', '二', '三', '四']) feedback.notify(text, 'info', { timeout: 0 })
  assert.deepEqual(
    feedback.toasts.map((t) => t.message),
    ['二', '三', '四'],
  )
})

test('error / warn / success 只是不同样式', () => {
  const feedback = freshStore()

  feedback.success('成功', { timeout: 0 })
  feedback.error('失败', { timeout: 0 })
  feedback.warn('警告', { timeout: 0 })

  assert.deepEqual(
    feedback.toasts.map((t) => t.type),
    ['success', 'error', 'warn'],
  )
})

test('confirm 等待用户选择并返回布尔值', async () => {
  const feedback = freshStore()

  const pending = feedback.confirm({ title: '删除选手', message: '确认删除？', danger: true })
  assert.equal(feedback.dialog.title, '删除选手')
  assert.equal(feedback.dialog.danger, true)

  feedback.settle(true)
  assert.equal(await pending, true)
  assert.equal(feedback.dialog, null)
})

test('confirm 取消返回 false；新的确认会取消上一个', async () => {
  const feedback = freshStore()

  const first = feedback.confirm({ title: 'A' })
  const second = feedback.confirm({ title: 'B' })
  assert.equal(await first, false, '被后来的确认框顶掉时按取消处理')

  feedback.settle(false)
  assert.equal(await second, false)
})

test('settle 在没有待确认弹窗时是空操作', () => {
  const feedback = freshStore()
  assert.doesNotThrow(() => feedback.settle(true))
  assert.equal(feedback.dialog, null)
})
