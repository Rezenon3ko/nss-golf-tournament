/**
 * 假的 Supabase 后端：只实现 tournament_state 用到的四种调用形态
 *   select(cols).eq('key', k).maybeSingle()
 *   update(payload).eq('key', k).eq('revision', n).select('revision')
 *   insert(row) / upsert(row, opts)
 * 用来在无网络、无真库的前提下验证同步引擎。
 */

function ok(data) {
  return Promise.resolve({ data, error: null })
}

// 真库走 JSON 序列化；这里也用 JSON 往返，避免 Vue 响应式代理无法结构化克隆
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

export const backend = {
  row: null,
  readError: null,
  writeError: null,
  missingRevisionColumn: false,
  // 模拟 schema.sql 里的 before update 触发器：revision 由数据库自己推进
  serverTrigger: false,
  // 模拟 RLS 策略未放行：UPDATE 命中 0 行且不报错（PostgREST 的真实行为）
  rlsBlocksUpdate: false,
  // 模拟 RLS 拦截 INSERT：WITH CHECK 失败会返回 42501
  rlsBlocksInsert: false,
  // 模拟未配置 Storage（本地模式）
  disableStorage: false,
  // 空表时服务端的返回形态：'pgrst116'（PostgREST 默认，406 + PGRST116）或 'null'（200 + null）
  emptyRowResponse: 'pgrst116',
  storageUploads: [],
  storageRemoves: [],
  writes: [],
  upserts: [],
  attempts: 0,

  reset({
    row = null,
    readError = null,
    writeError = null,
    missingRevisionColumn = false,
    serverTrigger = false,
    rlsBlocksUpdate = false,
    rlsBlocksInsert = false,
    disableStorage = false,
    emptyRowResponse = 'pgrst116',
  } = {}) {
    this.row = row ? { ...row, value: clone(row.value) } : null
    this.readError = readError
    this.writeError = writeError
    this.missingRevisionColumn = missingRevisionColumn
    this.serverTrigger = serverTrigger
    this.rlsBlocksUpdate = rlsBlocksUpdate
    this.rlsBlocksInsert = rlsBlocksInsert
    this.disableStorage = disableStorage
    this.emptyRowResponse = emptyRowResponse
    this.storageUploads = []
    this.storageRemoves = []
    this.writes = []
    this.upserts = []
    this.attempts = 0
  },

  // 模拟「另一台设备刚写过」
  bumpRemoteRevision() {
    if (this.row) this.row.revision += 1
  },

  missingColumnError() {
    return {
      code: '42703',
      message: 'column tournament_state.revision does not exist',
    }
  },

  read({ columns }) {
    if (this.readError) return Promise.resolve({ data: null, error: this.readError })
    const wantsRevision = String(columns || '').includes('revision')
    if (wantsRevision && this.missingRevisionColumn) {
      return Promise.resolve({ data: null, error: this.missingColumnError() })
    }
    // 表里没有行：PostgREST 用 406 + PGRST116 表示「JSON object requested, 0 rows」
    if (!this.row) {
      if (this.emptyRowResponse === 'null') return ok(null)
      return Promise.resolve({
        data: null,
        error: {
          code: 'PGRST116',
          details: 'Results contain 0 rows, application/vnd.pgrst.object+json requires 1 row',
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        },
      })
    }
    return ok({
      value: clone(this.row.value),
      ...(wantsRevision ? { revision: this.row.revision } : {}),
    })
  },

  update({ payload, filters }) {
    if (this.writeError) return Promise.resolve({ data: null, error: this.writeError })
    if (this.missingRevisionColumn) {
      return Promise.resolve({ data: null, error: this.missingColumnError() })
    }
    this.attempts += 1
    if (this.rlsBlocksUpdate) return ok([])
    const matches =
      this.row &&
      this.row.key === filters.key &&
      Number(this.row.revision) === Number(filters.revision)
    if (!matches) return ok([])
    this.writes.push(clone(payload.value))
    const nextRevision = this.serverTrigger ? Number(this.row.revision) + 1 : payload.revision
    this.row = {
      key: filters.key,
      value: clone(payload.value),
      revision: nextRevision,
      updated_at: this.serverTrigger ? new Date().toISOString() : payload.updated_at,
    }
    return ok([{ revision: this.row.revision }])
  },

  insert({ row }) {
    if (this.writeError) return Promise.resolve({ data: null, error: this.writeError })
    if (this.missingRevisionColumn) {
      return Promise.resolve({ data: null, error: this.missingColumnError() })
    }
    if (this.rlsBlocksInsert) {
      return Promise.resolve({
        data: null,
        error: {
          code: '42501',
          message: 'new row violates row-level security policy for table "tournament_state"',
        },
      })
    }
    if (this.row) {
      return Promise.resolve({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint' },
      })
    }
    this.writes.push(clone(row.value))
    this.row = { ...row, value: clone(row.value) }
    return ok([{ revision: row.revision }])
  },

  upsert({ row }) {
    if (this.writeError) return Promise.resolve({ data: null, error: this.writeError })
    this.upserts.push(clone(row.value))
    this.row = {
      key: row.key,
      value: clone(row.value),
      revision: this.row ? this.row.revision : 0,
    }
    return ok([{ revision: this.row.revision }])
  },
}

export const supabase = {
  get storage() {
    if (backend.disableStorage) return null
    return {
      from(bucket) {
        return {
          upload(path, blob, options) {
            backend.storageUploads.push({ bucket, path, blob, options })
            if (backend.writeError) {
              return Promise.resolve({ data: null, error: backend.writeError })
            }
            return Promise.resolve({ data: { path }, error: null })
          },
          getPublicUrl(path) {
            return {
              data: {
                publicUrl: `https://stub.supabase.local/storage/v1/object/public/${bucket}/${path}`,
              },
            }
          },
          remove(paths) {
            backend.storageRemoves.push({ bucket, paths })
            return Promise.resolve({ data: paths, error: null })
          },
        }
      },
    }
  },
  from() {
    return {
      select(columns) {
        const state = { columns, filters: {} }
        const builder = {
          eq(column, value) {
            state.filters[column] = value
            return builder
          },
          maybeSingle: () => backend.read(state),
          then: (resolve, reject) => backend.read(state).then(resolve, reject),
        }
        return builder
      },
      update(payload) {
        const state = { payload, filters: {} }
        const builder = {
          eq(column, value) {
            state.filters[column] = value
            return builder
          },
          select: () => backend.update(state),
        }
        return builder
      },
      insert: (row) => backend.insert({ row }),
      upsert: (row) => backend.upsert({ row }),
    }
  },
}
