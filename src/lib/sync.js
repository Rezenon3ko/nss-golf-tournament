/**
 * 云端同步的纯函数工具：不依赖 Vue / Supabase，便于单独测试。
 * 写入策略：乐观锁（revision）+ 串行队列 + 指数退避重试。
 */

export const SYNC_ROW_KEY = 'main'

// 防抖：连续操作（如批量改 DDL、连续判负）合并成一次写入
export const WRITE_DEBOUNCE_MS = 300

export const RETRY_BASE_MS = 1000
export const RETRY_MAX_MS = 30000

// 第 attempt 次失败后等待多久再试（1 → 1s，2 → 2s，… 上限 30s）
export function nextRetryDelay(attempt, base = RETRY_BASE_MS, max = RETRY_MAX_MS) {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1
  return Math.min(base * 2 ** (n - 1), max)
}

function messageOf(error) {
  return String(error?.message || '')
}

function codeOf(error) {
  return String(error?.code || '')
}

// 老库未执行新版 schema.sql（缺 revision 列）时，降级为覆盖式写入
export function isMissingRevisionColumn(error) {
  if (!error) return false
  return codeOf(error) === '42703' || /column .*revision.* does not exist/i.test(messageOf(error))
}

export function isDuplicateKey(error) {
  if (!error) return false
  return codeOf(error) === '23505' || /duplicate key value/i.test(messageOf(error))
}

/**
 * 「表里没有这一行」不是失败。
 *
 * `.maybeSingle()` 只会在服务端返回多行时被 SDK 归一化；若服务端对 0 行返回
 * 406 + PGRST116（details 里是 "Results contain 0 rows"），调用方会拿到 error。
 * 首次部署（云端还没有数据）与「行被删掉后重建」都会走到这里，
 * 必须当成 data = null 处理，否则会被误判为云端不可用而进入本地模式。
 */
export function isNoRowsError(error) {
  if (!error) return false
  const details = String(error.details || '')
  const message = `${details} ${messageOf(error)}`
  if (!/PGRST116/i.test(codeOf(error)) && !/JSON object requested/i.test(message)) return false
  return /0 rows/i.test(details) || /Results contain 0 rows/i.test(message)
}

export function createConflictError(remote) {
  const error = new Error('云端数据已被其他设备更新')
  error.isConflict = true
  error.remote = remote || null
  return error
}

/**
 * 更新命中 0 行、但云端版本号并没有前进时用这个：
 * 这不是并发冲突，而是写入没被放行（RLS 策略未匹配，例如换了账号或策略绑定了别的 UID）。
 * 若当成冲突处理，界面会一直弹「云端已被其他设备更新」，误导主办方。
 */
export function createForbiddenError(message = '当前账号没有写入权限，请确认已用主办方账号登录') {
  const error = new Error(message)
  error.isForbidden = true
  return error
}

/**
 * 把 Supabase / 网络异常翻译成给主办方看的中文提示。
 * @returns {{kind: 'auth'|'forbidden'|'network'|'unknown', message: string}}
 */
export function classifySyncError(error) {
  const message = messageOf(error)
  const code = codeOf(error)
  const status = Number(error?.status ?? error?.statusCode ?? 0)

  if (error?.isForbidden) {
    return {
      kind: 'forbidden',
      message: message || '当前账号没有写入权限，请确认已用主办方账号登录',
    }
  }
  if (status === 401 || /jwt|token|not authenticated|refresh token/i.test(message)) {
    return { kind: 'auth', message: '主办方登录已过期，请重新登录后再同步' }
  }
  if (
    status === 403 ||
    code === '42501' ||
    /row-level security|permission denied|violates row-level/i.test(message)
  ) {
    return { kind: 'forbidden', message: '当前账号没有写入权限，请确认已用主办方账号登录' }
  }
  if (
    error instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message)
  ) {
    return { kind: 'network', message: '网络异常，稍后会自动重试' }
  }
  return { kind: 'unknown', message: message ? `同步失败：${message}` : '同步失败，稍后会自动重试' }
}
