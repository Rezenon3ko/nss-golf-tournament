/**
 * 计分规则的纯函数实现：BO3 / BO5、平分进入 SD、以及「分出胜负之后的局不计入」。
 *
 * 规则依据：小组赛三局两胜（先 2 局）、淘汰赛五局三胜（先 3 局）；
 * 单局平分由 SD 胜者决定该局归属；单局杆数（相对标准杆）用于净胜杆排名。
 * 一旦有人先到 2 / 3 局，比赛即结束，之后误填的局既不算胜负，也不算净胜局/净胜杆。
 */

export function needWins(stage) {
  return stage === 'group' ? 2 : 3
}

export function setWinnerId(set, playerAId, playerBId) {
  if (!set || set.a == null || set.b == null) return null
  if (set.a < set.b) return playerAId
  if (set.b < set.a) return playerBId
  return set.sdWinner || null
}

/**
 * 截取「计入成绩」的局：按顺序累计胜局，先到 need 局即封盘。
 * @param {Array} sets 比赛的全部局（可能包含决定胜负后误填的局）
 * @returns {Array} 应当计入的局（按原顺序）
 */
export function countedSets(sets, { stage, playerAId, playerBId }) {
  const need = needWins(stage)
  const counted = []
  let winsA = 0
  let winsB = 0
  for (const set of sets || []) {
    counted.push(set)
    const winner = setWinnerId(set, playerAId, playerBId)
    if (winner && winner === playerAId) winsA += 1
    else if (winner && winner === playerBId) winsB += 1
    if (winsA >= need || winsB >= need) break
  }
  return counted
}

// 计入成绩的胜局数（键名保持 A / B，与既有代码一致）
export function countSetWins(sets, match) {
  const wins = { A: 0, B: 0 }
  for (const set of countedSets(sets, match)) {
    const winner = setWinnerId(set, match.playerAId, match.playerBId)
    if (winner === match.playerAId) wins.A += 1
    else if (winner === match.playerBId) wins.B += 1
  }
  return wins
}

// 已出现的局数上限（用于录入界面标注「本局不计入」）
export function countedSetCount(sets, match) {
  return countedSets(sets, match).length
}
