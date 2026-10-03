import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildFinalResultText } from '../src/lib/finalResult.js'

function set(a, b, sdWinner = null) {
  return { a, b, sdWinner }
}

function match(id, stage, aId, bId, sets, extra = {}) {
  return {
    id,
    stage,
    groupId: extra.groupId ?? null,
    round: extra.round ?? null,
    order: extra.order ?? null,
    playerAId: aId,
    playerBId: bId,
    sets,
    status: extra.status ?? 'complete',
  }
}

const players = [
  { id: 'p1', name: '甲', bestScore: -13, groupId: 'A' },
  { id: 'p2', name: '乙', bestScore: -8, groupId: 'A' },
  { id: 'p3', name: '丙', bestScore: -12, groupId: 'A' },
  { id: 'p4', name: '丁', bestScore: -9, groupId: 'A' },
  { id: 'p5', name: '戊', bestScore: -6, groupId: 'B' },
  { id: 'p6', name: '己', bestScore: -6, groupId: 'B' },
  { id: 'p7', name: '庚', bestScore: -11, groupId: 'B' },
  { id: 'p8', name: '辛', bestScore: -7, groupId: 'B' },
]

// 八强 → 半决赛 → 决赛（甲 冠军、戊 亚军）
const knockoutMatches = [
  { stage: 'qf', order: 1, playerAId: 'p1', playerBId: 'p2' },
  { stage: 'qf', order: 2, playerAId: 'p3', playerBId: 'p4' },
  { stage: 'qf', order: 3, playerAId: 'p5', playerBId: 'p6' },
  { stage: 'qf', order: 4, playerAId: 'p7', playerBId: 'p8' },
  { stage: 'sf', order: 1, playerAId: 'p1', playerBId: 'p3' },
  { stage: 'sf', order: 2, playerAId: 'p5', playerBId: 'p7' },
  { stage: 'final', order: 1, playerAId: 'p1', playerBId: 'p5' },
]

const matches = [
  // 甲 两次 SD 胜场；丙 的 -12 与报名 PB 持平不算突破
  match('g1', 'group', 'p1', 'p3', [set(-12, -12, 'p1'), set(-10, -9)]),
  // 丁 一次 SD 胜场；戊 两局 -8 都优于报名 PB -6
  match('g2', 'group', 'p4', 'p5', [set(-8, -8, 'p4'), set(-5, -8)]),
  // 乙 一局 -11 优于报名 PB -8
  match('g3', 'group', 'p1', 'p2', [set(-11, -11, 'p1')]),
]

test('最终结果：冠军、亚军、四强、八强与隐藏奖（名次不重复）', () => {
  const text = buildFinalResultText({
    siteName: '测试赛',
    players,
    matches,
    knockoutMatches,
    championId: 'p1',
    runnerUpId: 'p5',
  })

  assert.ok(text.startsWith('测试赛 · 最终结果\n'), '标题带站点名')
  assert.match(text, /🏆 冠军：甲/)
  assert.match(text, /🥈 亚军：戊/)
  // 四强去掉冠亚军，八强再去掉四强
  assert.match(text, /四强：丙、庚/)
  assert.match(text, /八强：乙、丁、己、辛/)
  assert.ok(!text.includes('16 强'), '不再输出 16 强')
  assert.match(text, /SD 之王（SD 胜场最多）：甲（2 胜）/)
  assert.match(text, /PB 之星（PB 突破最多）：戊（2 次）/)
})

test('最终结果：未决出与无人上榜时的占位文案', () => {
  const text = buildFinalResultText({
    siteName: '测试赛',
    players,
    matches: [],
    knockoutMatches: [],
  })

  assert.match(text, /🏆 冠军：（未决出）/)
  assert.match(text, /🥈 亚军：（未决出）/)
  assert.match(text, /四强：（未决出）/)
  assert.match(text, /八强：（未决出）/)
  assert.ok(!text.includes('16 强'), '不再输出 16 强')
  assert.match(text, /SD 之王（SD 胜场最多）：（本届没有 SD 或未记录胜者）/)
  assert.match(text, /PB 之星（PB 突破最多）：（本届无人突破 PB）/)
})

test('最终结果：隐藏奖并列时全部列出', () => {
  const tied = [
    { id: 'a', name: '甲', bestScore: -5 },
    { id: 'b', name: '乙', bestScore: -5 },
  ]
  const tiedMatches = [match('m1', 'group', 'a', 'b', [set(-6, -6, 'a'), set(-7, -7, 'b')])]

  const text = buildFinalResultText({
    players: tied,
    matches: tiedMatches,
    knockoutMatches: [],
  })

  assert.match(text, /SD 之王（SD 胜场最多）：甲、乙（各 1 胜）/)
  assert.match(text, /PB 之星（PB 突破最多）：甲、乙（各 2 次）/)
})

test('最终结果：冠军未决出时四强完整列出，八强去掉四强', () => {
  const roster = ['甲', '乙', '丙', '丁', '戊', '己'].map((name, index) => ({
    id: `p${index + 1}`,
    name,
  }))
  const knockout = [
    { stage: 'qf', order: 1, playerAId: 'p1', playerBId: 'p2' },
    { stage: 'qf', order: 2, playerAId: 'p3', playerBId: 'p4' },
    { stage: 'qf', order: 3, playerAId: 'p5', playerBId: 'p6' },
    { stage: 'sf', order: 1, playerAId: 'p1', playerBId: 'p3' },
    // 对位未定（locked）不占名额
    { stage: 'sf', order: 2, playerAId: null, playerBId: null },
  ]

  const text = buildFinalResultText({
    players: roster,
    knockoutMatches: knockout,
  })

  assert.match(text, /四强：甲、丙/)
  assert.match(text, /八强：乙、丁、戊、己/)
})
