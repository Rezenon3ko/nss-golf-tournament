import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局反馈：轻提示（toast）+ 确认弹窗。
 * 用应用内的组件替代 window.alert / window.confirm：
 * 不阻塞主线程、样式统一、可自动化测试。
 */

const DEFAULT_TIMEOUT = 3200
const MAX_TOASTS = 3

let seq = 0

export const useFeedbackStore = defineStore('feedback', () => {
  const toasts = ref([])
  // { title, message, confirmLabel, cancelLabel, danger, resolve }
  const dialog = ref(null)

  function dismiss(id) {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  function notify(message, type = 'info', { timeout = DEFAULT_TIMEOUT } = {}) {
    const text = String(message ?? '').trim()
    if (!text) return null
    seq += 1
    const id = seq
    toasts.value.push({ id, message: text, type })
    if (toasts.value.length > MAX_TOASTS) {
      toasts.value = toasts.value.slice(-MAX_TOASTS)
    }
    if (timeout > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => dismiss(id), timeout)
    }
    return id
  }

  const success = (message, options) => notify(message, 'success', options)
  const error = (message, options) => notify(message, 'error', options)
  const warn = (message, options) => notify(message, 'warn', options)

  /**
   * 应用中文化确认弹窗：await 得到 true / false。
   * 同一时刻只允许一个确认框，后来的请求会覆盖前一个（前一个 resolve(false)）。
   */
  function confirm(options = {}) {
    return new Promise((resolve) => {
      if (dialog.value) dialog.value.resolve(false)
      dialog.value = {
        title: options.title || '请确认',
        message: options.message || '',
        confirmLabel: options.confirmLabel || '确认',
        cancelLabel: options.cancelLabel || '取消',
        danger: options.danger === true,
        resolve,
      }
    })
  }

  function settle(result) {
    const current = dialog.value
    dialog.value = null
    if (current) current.resolve(!!result)
  }

  return {
    toasts,
    dialog,
    notify,
    success,
    error,
    warn,
    dismiss,
    confirm,
    settle,
  }
})
