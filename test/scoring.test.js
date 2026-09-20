import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  countSetWins,
  countedSetCount,
  countedSets,
  needWins,
  setWinnerId,
} from '../src/lib/scoring.js'

const BO3 = { stage: 'group', playerAId: 'A', playerBId: 'B' }
const BO5 = { stage: 'final', playerAId: 'A', playerBId: 'B' }

function sets(...pairs) {
  return pairs.map(([a, b, sdWinner = null]) => ({ a, b, sdWinner }))
}

test('needWins：小组赛 2 局、淘汰赛 3 局', () => {
  assert.equal(needWins('group'), 2)
  assert.equal(needWins('qf'), 3)
  assert.equal(needWins('sf'), 3)
  assert.equal(needWins('final'), 3)
})

test('setWinnerId：杆数小者胜、平分看 SD、缺数据不算', () => {
  assert.equal(setWinnerId({ a: -14, b: -12 }, 'A', 'B'), 'A')
  assert.equal(setWinnerId({ a: -12, b: -14 }, 'A', 'B'), 'B')
  assert.equal(setWinnerId({ a: -12, b: -12, sdWinner: 'B' }, 'A', 'B'), 'B')
  assert.equal(setWinnerId({ a: -12, b: -12, sdWinner: null }, 'A', 'B'), null)
  assert.equal(setWinnerId({ a: null, b: -12 }, 'A', 'B'), null)
  assert.equal(setWinnerId(undefined, 'A', 'B'), null)
})

test('BO3 先到 2 局即封盘：决胜局之后误填的局不计入', () => {
  const all = sets([-14, -12], [-10, -8], [-30, -1])

  assert.equal(countedSets(all, BO3).length, 2)
  assert.equal(countedSetCount(all, BO3), 2)
  assert.deepEqual(countSetWins(all, BO3), { A: 2, B: 0 })
})

test('BO3 打到 1:1 时第 3 局计入', () => {
  const all = sets([-14, -12], [-8, -10], [-16, -20])

  assert.equal(countedSetCount(all, BO3), 3)
  assert.deepEqual(countSetWins(all, BO3), { A: 1, B: 2 })
})

test('BO5 先到 3 局即封盘：第 4、5 局不计入', () => {
  const all = sets([-14, -12], [-10, -8], [-12, -9], [-30, -1], [-30, -1])

  assert.equal(countedSetCount(all, BO5), 3)
  assert.deepEqual(countSetWins(all, BO5), { A: 3, B: 0 })
})

test('SD 平局计入该局归属，并参与封盘判断', () => {
  const all = sets([-12, -12, 'A'], [-12, -12, 'A'], [-30, -1])

  assert.equal(countedSetCount(all, BO3), 2)
  assert.deepEqual(countSetWins(all, BO3), { A: 2, B: 0 })
})

test('双方负（未填写任何杆数）不会产生胜局', () => {
  const all = sets([null, null], [null, null], [null, null])

  assert.equal(countedSetCount(all, BO3), 3)
  assert.deepEqual(countSetWins(all, BO3), { A: 0, B: 0 })
})
