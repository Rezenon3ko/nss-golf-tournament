/**
 * Phase 1 双写镜像：把「本地文档状态」与「上次已同步到多表的基线」做差异，
 * 只把变化的部分通过 RPC 推到新表；任何一步失败都不推进基线，下次自动重试。
 *
 * 设计要点
 * - 基线持久化到 localStorage：刷新页面后仍然知道哪些已同步；
 * - 只增数据（日志 / 抽签记录）按 id 去重后追加，重复执行安全；
 * - 结构类操作（发布分组 / 重置赛事）由 store 显式标记 wholesale，
 *   镜像只调用对应的整体 RPC，不再逐行推送赛程差异；
 * - 删除类操作（选手 / 证据）容忍 PT404：重试时对象可能已经不在了。
 */

function normalizeMirrorState(state = {}) {
  return {
    players: state.players || [],
    matches: state.matches || [],
    ddlRounds: state.ddlRounds || [],
    tiebreakResolutions: state.tiebreakResolutions || {},
    evidence: state.evidence || [],
    championId: state.championId ?? null,
    runnerUpId: state.runnerUpId ?? null,
    draft: state.draft ?? null,
    logs: state.logs || [],
    drawHistory: state.drawHistory || [],
  }
}

/**
 * 基线快照：深拷贝一份状态。
 * store 里的状态是原地修改的（数组 push / 对象字段赋值），如果基线直接持有这些引用，
 * 它会跟着一起变，差异计算永远为空——改动只会留在本机缓存和备份文档里。
 */
function snapshotState(state = {}) {
  return normalizeMirrorState(JSON.parse(JSON.stringify(normalizeMirrorState(state))))
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function diffSeasonState(previous, next, { skipMatches = false } = {}) {
  const prev = normalizeMirrorState(previous)
  const curr = normalizeMirrorState(next)

  const diff = {
    playersUpsert: [],
    playersDelete: [],
    ddl: [],
    draftChanged: false,
    matches: [],
    matchesRemoved: [],
    tiebreaks: [],
    evidenceUpsert: [],
    evidenceDelete: [],
    logs: [],
    draws: [],
    seasonPatch: null,
  }

  // 选手：含名单位置（sortOrder），删除后其余选手顺序变化也会同步
  const prevPlayers = new Map(prev.players.map((player, index) => [player.id, { player, index }]))
  curr.players.forEach((player, index) => {
    const before = prevPlayers.get(player.id)
    const comparable = { ...player, sortOrder: index }
    if (!before || !same({ ...before.player, sortOrder: before.index }, comparable)) {
      diff.playersUpsert.push({ player, sortOrder: index })
    }
  })
  const currPlayerIds = new Set(curr.players.map((player) => player.id))
  for (const [id] of prevPlayers) {
    if (!currPlayerIds.has(id)) diff.playersDelete.push(id)
  }

  // DDL：按 key 比较（ddl 统一成墙上时间字符串）
  const prevDdl = new Map(prev.ddlRounds.map((round) => [round.key, round]))
  for (const round of curr.ddlRounds) {
    const before = prevDdl.get(round.key)
    if (!before || !same(before, round)) diff.ddl.push(round)
  }

  // 分组草稿
  diff.draftChanged = !same(prev.draft, curr.draft)

  // 赛程：结构类操作（发布 / 重置）由整体 RPC 负责，跳过逐行差异
  if (!skipMatches) {
    const prevMatches = new Map(prev.matches.map((match) => [match.id, match]))
    for (const match of curr.matches) {
      const before = prevMatches.get(match.id)
      if (!before || !same(before, match)) diff.matches.push(match)
    }
    const currMatchIds = new Set(curr.matches.map((match) => match.id))
    for (const [id] of prevMatches) {
      if (!currMatchIds.has(id)) diff.matchesRemoved.push(id)
    }
  }

  // 同分抽签解决：按组整组替换；出现清空（极少见）时由整体操作负责
  const groups = new Set([
    ...Object.keys(prev.tiebreakResolutions),
    ...Object.keys(curr.tiebreakResolutions),
  ])
  for (const groupId of groups) {
    const before = prev.tiebreakResolutions[groupId] || []
    const after = curr.tiebreakResolutions[groupId] || []
    if (same(before, after) || after.length === 0) continue
    after.forEach((playerId, index) => {
      diff.tiebreaks.push({ group_id: groupId, player_id: playerId, position: index })
    })
  }

  // 证据
  const prevEvidence = new Map(prev.evidence.map((item) => [item.id, item]))
  for (const item of curr.evidence) {
    const before = prevEvidence.get(item.id)
    if (!before || !same(before, item)) diff.evidenceUpsert.push(item)
  }
  const currEvidenceIds = new Set(curr.evidence.map((item) => item.id))
  for (const [id] of prevEvidence) {
    if (!currEvidenceIds.has(id)) diff.evidenceDelete.push(id)
  }

  // 只增：日志与抽签记录按 id 去重
  const prevLogIds = new Set(prev.logs.map((entry) => entry.id))
  diff.logs = curr.logs.filter((entry) => !prevLogIds.has(entry.id))
  const prevDrawIds = new Set(prev.drawHistory.map((draw) => draw.id))
  diff.draws = curr.drawHistory.filter((draw) => !prevDrawIds.has(draw.id))

  // 赛季补丁：冠军 / 亚军
  const patch = {}
  if (prev.championId !== curr.championId) patch.champion_player_id = curr.championId
  if (prev.runnerUpId !== curr.runnerUpId) patch.runner_up_player_id = curr.runnerUpId
  diff.seasonPatch = Object.keys(patch).length ? patch : null

  return diff
}

export function isEmptyDiff(diff) {
  return (
    diff.playersUpsert.length === 0 &&
    diff.playersDelete.length === 0 &&
    diff.ddl.length === 0 &&
    !diff.draftChanged &&
    diff.matches.length === 0 &&
    diff.matchesRemoved.length === 0 &&
    diff.tiebreaks.length === 0 &&
    diff.evidenceUpsert.length === 0 &&
    diff.evidenceDelete.length === 0 &&
    diff.logs.length === 0 &&
    diff.draws.length === 0 &&
    !diff.seasonPatch
  )
}

async function ignoreMissing(run) {
  try {
    await run()
  } catch (error) {
    if (error?.code === 'PT404') return
    throw error
  }
}

export function createMirrorController({
  repository,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  baselineKey,
}) {
  let baseline = null
  let wholesale = null

  function persistBaseline() {
    if (!storage || !baselineKey) return
    try {
      storage.setItem(baselineKey, JSON.stringify(baseline))
    } catch {
      // 存储不可用（隐私模式 / 配额）时只影响刷新后的基线，不影响本次同步
    }
  }

  function ensureBaseline() {
    if (baseline) return baseline
    let loaded = null
    if (storage && baselineKey) {
      try {
        const raw = storage.getItem(baselineKey)
        if (raw) loaded = normalizeMirrorState(JSON.parse(raw))
      } catch {
        loaded = null
      }
    }
    baseline = loaded || normalizeMirrorState({})
    return baseline
  }

  return {
    hasBaseline() {
      if (baseline) return true
      if (!storage || !baselineKey) return false
      try {
        return !!storage.getItem(baselineKey)
      } catch {
        return false
      }
    },

    setBaseline(state) {
      baseline = snapshotState(state)
      persistBaseline()
    },

    setWholesale(kind) {
      if (kind === 'publish' || kind === 'reset') wholesale = kind
    },

    wholesalePending() {
      return wholesale
    },

    pending(state) {
      if (wholesale) return true
      return !isEmptyDiff(diffSeasonState(ensureBaseline(), state, { skipMatches: false }))
    },

    async sync(state) {
      // 用深拷贝做这一轮的基准：同步期间状态被继续修改也不影响本轮差异
      const next = snapshotState(state)
      const activeWholesale = wholesale
      const diff = diffSeasonState(ensureBaseline(), next, {
        skipMatches: activeWholesale !== null,
      })

      if (activeWholesale === 'reset') {
        await repository.resetSeason()
      } else if (activeWholesale === 'publish') {
        await repository.publishGroups({ players: next.players, matches: next.matches })
      }

      for (const { player, sortOrder } of diff.playersUpsert) {
        await repository.upsertPlayer(player, sortOrder)
      }
      for (const id of diff.playersDelete) {
        await ignoreMissing(() => repository.deletePlayer(id))
      }

      if (activeWholesale === null) {
        if (diff.matches.length || diff.seasonPatch) {
          await repository.applyChangeset({
            matches: diff.matches,
            seasonPatch: diff.seasonPatch,
          })
        }
        if (diff.tiebreaks.length) {
          await repository.saveTiebreaks(diff.tiebreaks)
        }
      }

      for (const round of diff.ddl) await repository.setDdl(round)
      if (diff.draftChanged) await repository.saveDraft(next.draft)

      for (const item of diff.evidenceUpsert) {
        await repository.applyEvidence({ op: 'add', evidence: item })
      }
      for (const id of diff.evidenceDelete) {
        await ignoreMissing(() => repository.applyEvidence({ op: 'remove', id }))
      }

      if (diff.logs.length) await repository.appendLogs(diff.logs)
      for (const draw of diff.draws) await repository.appendDraw(draw)

      baseline = next
      wholesale = null
      persistBaseline()
      return diff
    },

    reset() {
      baseline = null
      wholesale = null
      if (storage && baselineKey) {
        try {
          storage.removeItem(baselineKey)
        } catch {
          // 忽略
        }
      }
    },
  }
}
