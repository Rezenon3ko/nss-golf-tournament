import { ref } from 'vue'

/**
 * 全局「当前时间」心跳。
 * DDL 倒计时、逾期高亮、赛程列表的逾期判断都读它，
 * 这样页面放着不动也会自己刷新，而不是等下一次操作或手动刷新。
 */
export const TICK_MS = 30 * 1000

export const nowMs = ref(Date.now())

export function tick() {
  nowMs.value = Date.now()
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.setInterval(tick, TICK_MS)
  // 标签页切回来时立刻校正（后台标签页的定时器可能被节流）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick()
  })
}
