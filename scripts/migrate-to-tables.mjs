#!/usr/bin/env node
/**
 * 旧单文档 → 多表迁移（Phase 0）
 *
 * 把 public.tournament_state 里的一份 JSON 快照，按 src/lib/seasonSnapshot.js
 * 的映射写入 supabase/schema-v2.sql 建出的新表，导入为「一个赛季」。
 *
 * 用法（在项目根目录执行）：
 *   node scripts/migrate-to-tables.mjs --dry-run
 *      只读旧快照，做「快照 → 行 → 快照」往返校验与统计对账，不登录、不写数据。
 *   node scripts/migrate-to-tables.mjs --apply --slug 2026 --name "2026 赛季"
 *      登录主办方账号后写入新表；可重复执行（幂等 upsert）。
 *   node scripts/migrate-to-tables.mjs --verify --slug 2026
 *      重新读取新表并拼回快照，与旧快照逐字段对账。
 *
 * 密码：优先读环境变量 NSS_ADMIN_PASSWORD；未设置时在交互终端里提示输入（不回显）。
 * 选项：--slug（默认 2026）、--name（默认「<slug> 赛季」）、--season-id（默认 s-<slug>）、
 *       --env <路径>（默认 .env）
 *
 * 前提：先在 Supabase SQL Editor 执行 supabase/schema-v2.sql，
 *       并确认主办方账号已进入 public.admins 白名单（该文件会按邮箱自动播种）。
 *
 * 注意：--apply 会把导入的赛季设为「当前赛季」（is_current=true）。
 *       同一时间只允许一个当前赛季；以后再迁移第二个赛季前，
 *       需要先把上一个赛季的 is_current 置为 false（后台赛季管理功能在 Phase 2 提供）。
 */

import { bulkUpsert, createRest, loadEnvFile, signIn } from './lib/supabase-rest.mjs'
import {
  canonicalizeSnapshot,
  diffCanonical,
  matchUpdateOrder,
  rowsToSnapshot,
  runnerUpOf,
  snapshotToRows,
} from '../src/lib/seasonSnapshot.js'
import { buildPbStats, buildSdStats } from '../src/lib/stats.js'

const USAGE = `用法：
  node scripts/migrate-to-tables.mjs --dry-run [--slug 2026] [--name "2026 赛季"]
  node scripts/migrate-to-tables.mjs --apply   [--slug 2026] [--name "2026 赛季"]
  node scripts/migrate-to-tables.mjs --verify  [--slug 2026] [--season-id s-2026]

选项：
  --slug <slug>        赛季 slug（默认 2026）
  --name <名称>        赛季名称（默认「<slug> 赛季」）
  --season-id <id>     目标赛季 id（默认 s-<slug>）
  --env <路径>         环境文件路径（默认 .env）
  --help               显示本说明

密码通过环境变量 NSS_ADMIN_PASSWORD 提供，或在交互终端里按提示输入。`

function parseArgs(argv) {
  const args = { action: 'dry-run', slug: '2026', name: '', seasonId: '', envPath: '.env' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') args.action = 'dry-run'
    else if (arg === '--apply') args.action = 'apply'
    else if (arg === '--verify') args.action = 'verify'
    else if (arg === '--slug') args.slug = String(argv[(i += 1)] || '')
    else if (arg === '--name') args.name = String(argv[(i += 1)] || '')
    else if (arg === '--season-id') args.seasonId = String(argv[(i += 1)] || '')
    else if (arg === '--env') args.envPath = String(argv[(i += 1)] || '.env')
    else if (arg === '--help' || arg === '-h') {
      console.log(USAGE)
      process.exit(0)
    } else {
      throw new Error(`未知参数：${arg}（--help 查看用法）`)
    }
  }
  if (!args.slug) throw new Error('--slug 不能为空')
  args.name = args.name || `${args.slug} 赛季`
  args.seasonId = args.seasonId || `s-${args.slug}`
  return args
}

function loadConfig(args) {
  const fileEnv = loadEnvFile(args.envPath)
  const url = process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || ''
  const apiKey = process.env.VITE_SUPABASE_ANON_KEY || fileEnv.VITE_SUPABASE_ANON_KEY || ''
  const email = process.env.VITE_ADMIN_EMAIL || fileEnv.VITE_ADMIN_EMAIL || 'admin@nss.local'
  if (!url || !apiKey) {
    throw new Error(`缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（检查 ${args.envPath}）`)
  }
  return { url: url.replace(/\/+$/, ''), apiKey, email }
}

async function promptPassword(label) {
  if (process.env.NSS_ADMIN_PASSWORD) return process.env.NSS_ADMIN_PASSWORD
  if (!process.stdin.isTTY) {
    throw new Error('当前不是交互终端：请用 NSS_ADMIN_PASSWORD 环境变量提供主办方密码')
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(label)
    const stdin = process.stdin
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''
    const finish = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
    }
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (char === '\u0003') {
          finish()
          process.stdout.write('\n')
          reject(new Error('已取消'))
          return
        }
        if (char === '\u007f' || char === '\b') {
          if (value) {
            value = value.slice(0, -1)
            process.stdout.write('\b \b')
          }
        } else {
          value += char
          process.stdout.write('*')
        }
      }
    }
    stdin.on('data', onData)
  })
}

async function login(config) {
  const password = await promptPassword(`请输入主办方密码（${config.email}）：`)
  const session = await signIn({ ...config, password })
  console.log(`已用 ${session.email} 登录`)
  return session
}

async function fetchLegacySnapshot(rest) {
  const data = await rest.get('tournament_state?key=eq.main&select=value&limit=1')
  const value = Array.isArray(data) ? data[0]?.value : null
  if (!value || typeof value !== 'object') {
    throw new Error('云端还没有 tournament_state 数据（key=main），无需迁移')
  }
  return value
}

function summarize(snapshot, rows) {
  const players = snapshot.players || []
  const nameOf = (id) => players.find((p) => p.id === id)?.name || id || '—'
  return [
    `选手 ${rows.players.length}`,
    `比赛 ${rows.matches.length}`,
    `DDL ${rows.ddlRounds.length}`,
    `抽签记录 ${rows.draws.length}`,
    `证据 ${rows.evidence.length}`,
    `日志 ${rows.logs.length}`,
    `冠军 ${nameOf(snapshot.championId)}`,
    `亚军 ${nameOf(runnerUpOf(snapshot))}`,
  ].join(' · ')
}

function compareStats(snapshot, reconstructed) {
  const legacyStats = {
    sd: buildSdStats({ matches: snapshot.matches || [], players: snapshot.players || [] }),
    pb: buildPbStats({ matches: snapshot.matches || [], players: snapshot.players || [] }),
  }
  const rebuiltStats = {
    sd: buildSdStats({
      matches: reconstructed.matches || [],
      players: reconstructed.players || [],
    }),
    pb: buildPbStats({
      matches: reconstructed.matches || [],
      players: reconstructed.players || [],
    }),
  }
  const same = JSON.stringify(legacyStats) === JSON.stringify(rebuiltStats)
  return {
    same,
    summary: same
      ? `SD 榜与 PB 榜一致（SD ${legacyStats.sd.totalSd} 局 / 突破 ${legacyStats.pb.totalBreaks} 次）`
      : 'SD 榜或 PB 榜不一致，请先检查映射',
  }
}

function compareMatchOrder(snapshot, rebuilt) {
  const expected = matchUpdateOrder(snapshot)
  const actual = matchUpdateOrder(rebuilt)
  const same = JSON.stringify(expected) === JSON.stringify(actual)
  return {
    same,
    summary: same
      ? `比赛更新时间顺序一致（${expected.length} 场）`
      : '比赛更新时间顺序不一致：历史 updated_at 被覆盖（重跑一次 --apply 即可回填）',
  }
}

function assertRoundTrip(snapshot, rows, adminAvatar) {
  const reconstructed = rowsToSnapshot(rows, { adminAvatar })
  const diff = diffCanonical(canonicalizeSnapshot(snapshot), canonicalizeSnapshot(reconstructed))
  return { reconstructed, diff }
}

async function fetchSeasonBundle(rest, seasonId, uid) {
  const id = encodeURIComponent(seasonId)
  const [seasonRows, players, matches, ddlRounds, tiebreaks, draws, evidence, logs, profiles] =
    await Promise.all([
      rest.get(`seasons?id=eq.${id}&select=*`),
      rest.get(`players?season_id=eq.${id}&select=*`),
      rest.get(`matches?season_id=eq.${id}&select=*`),
      rest.get(`ddl_rounds?season_id=eq.${id}&select=*`),
      rest.get(`tiebreak_resolutions?season_id=eq.${id}&select=*`),
      rest.get(`draws?season_id=eq.${id}&select=*`),
      rest.get(`evidence?season_id=eq.${id}&select=*`),
      rest.get(`logs?season_id=eq.${id}&select=*`),
      uid ? rest.get(`admin_profiles?uid=eq.${encodeURIComponent(uid)}&select=avatar_url`) : [],
    ])
  return {
    season: seasonRows[0] || null,
    players,
    matches,
    ddlRounds,
    tiebreaks,
    draws,
    evidence,
    logs,
    adminAvatar: profiles[0]?.avatar_url ?? null,
  }
}

async function runDryRun(snapshot, args, rows) {
  console.log(`读取到旧快照：${summarize(snapshot, rows)}`)
  console.log(`目标赛季：${args.name}（${args.seasonId}，slug=${args.slug}）`)

  const { diff } = assertRoundTrip(snapshot, rows, snapshot.adminAvatar ?? null)
  if (diff) {
    console.error('往返校验：失败')
    console.error(`  首个差异在第 ${diff.index} 个字符附近：`)
    console.error(`  旧快照：…${diff.old}…`)
    console.error(`  重拼后：…${diff.next}…`)
    throw new Error('快照 → 行 → 快照 不一致，请检查映射')
  }
  console.log('往返校验：通过（快照 → 行 → 快照 完全一致）')

  const stats = compareStats(snapshot, rowsToSnapshot(rows, { adminAvatar: snapshot.adminAvatar }))
  console.log(`统计对账：${stats.summary}`)
  if (!stats.same) throw new Error('统计对账失败')

  const order = compareMatchOrder(
    snapshot,
    rowsToSnapshot(rows, { adminAvatar: snapshot.adminAvatar }),
  )
  console.log(`时间顺序：${order.summary}`)
  if (!order.same) throw new Error('比赛更新时间顺序对账失败')

  console.log('未写任何数据（dry-run）。加 --apply 才会写入新表。')
}

async function runApply(config, args, snapshot, rows) {
  const session = await login(config)
  const rest = createRest({ ...config, accessToken: session.accessToken })

  const admins = await rest.get(`admins?uid=eq.${encodeURIComponent(session.userId)}&select=uid`)
  if (!admins.length) {
    throw new Error(
      '当前账号不在 public.admins 白名单：请先在 SQL Editor 执行 supabase/schema-v2.sql（含按邮箱播种）',
    )
  }

  // 赛季先不带冠军（外键依赖 players），最后统一回填
  const seasonRow = { ...rows.season, champion_player_id: null, runner_up_player_id: null }
  const steps = [
    ['seasons', [seasonRow], 'id'],
    ['players', rows.players, 'id'],
    ['ddl_rounds', rows.ddlRounds, 'season_id,key'],
    ['matches', rows.matches, 'id'],
    ['tiebreak_resolutions', rows.tiebreaks, 'season_id,group_id,player_id'],
    ['draws', rows.draws, 'id'],
    ['evidence', rows.evidence, 'id'],
    ['logs', rows.logs, 'id'],
  ]
  for (const [table, tableRows, onConflict] of steps) {
    const count = await bulkUpsert(rest, table, tableRows, onConflict)
    console.log(`  ${table.padEnd(22)} 写入 ${count} 行`)
  }

  const patch = {
    champion_player_id: rows.season.champion_player_id,
    runner_up_player_id: rows.season.runner_up_player_id,
    draft_groups: rows.season.draft_groups,
  }
  await rest.patch(`seasons?id=eq.${encodeURIComponent(args.seasonId)}`, patch)

  if (snapshot.adminAvatar) {
    await bulkUpsert(
      rest,
      'admin_profiles',
      [{ uid: session.userId, avatar_url: snapshot.adminAvatar }],
      'uid',
    )
    console.log('  admin_profiles          写入主办方头像')
  }

  console.log(`完成：已导入赛季「${args.name}」（${args.seasonId}）`)
  console.log(`建议执行对账：node scripts/migrate-to-tables.mjs --verify --slug ${args.slug}`)
}

async function runVerify(config, args) {
  const session = await login(config)
  const rest = createRest({ ...config, accessToken: session.accessToken })
  const [legacy, bundle] = await Promise.all([
    fetchLegacySnapshot(rest),
    fetchSeasonBundle(rest, args.seasonId, session.userId),
  ])
  if (!bundle.season) throw new Error(`新表里没有找到赛季 ${args.seasonId}`)

  const reconstructed = rowsToSnapshot(bundle, { adminAvatar: bundle.adminAvatar })
  const diff = diffCanonical(canonicalizeSnapshot(legacy), canonicalizeSnapshot(reconstructed))
  if (diff) {
    console.error('对账失败：新表重拼的快照与旧快照不一致')
    console.error(`  首个差异在第 ${diff.index} 个字符附近：`)
    console.error(`  旧快照：…${diff.old}…`)
    console.error(`  重拼后：…${diff.next}…`)
    process.exitCode = 1
    return
  }

  const stats = compareStats(legacy, reconstructed)
  console.log('对账通过：新表重拼的快照与旧快照完全一致')
  console.log(`统计对账：${stats.summary}`)
  const order = compareMatchOrder(legacy, reconstructed)
  console.log(`时间顺序：${order.summary}`)
  if (!order.same) {
    process.exitCode = 1
    return
  }
  console.log(
    `赛季：${bundle.season.name}（${bundle.season.slug}）· 当前=${bundle.season.is_current} · 归档=${bundle.season.is_archived}`,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = loadConfig(args)

  if (args.action === 'dry-run') {
    // dry-run 只读公开数据，不需要登录
    const rest = createRest({ ...config, accessToken: null })
    const snapshot = await fetchLegacySnapshot(rest)
    const rows = snapshotToRows(snapshot, args)
    await runDryRun(snapshot, args, rows)
    return
  }

  if (args.action === 'apply') {
    const rest = createRest({ ...config, accessToken: null })
    const snapshot = await fetchLegacySnapshot(rest)
    const rows = snapshotToRows(snapshot, args)
    await runApply(config, args, snapshot, rows)
    return
  }

  await runVerify(config, args)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
