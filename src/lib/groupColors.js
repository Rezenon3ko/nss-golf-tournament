/**
 * 小组代表色（A/B/C/D）的唯一来源，供积分榜、小组赛、选手页、标签页共用。
 *
 * 浅色档是 Notion 风格粉彩色；深色档取自 css/main.css 里 @theme 的
 * --color-group-*-dark / -dark-hover / -accent token（比浅色档更深、更贴合深色背景）。
 * 这里只放颜色类，尺寸/圆角等排版类由调用方提供。
 */

const CHIP = {
  A: 'bg-[#e6e0f5] text-[#37352f] dark:bg-group-a-dark dark:text-[#cfc8e0]',
  B: 'bg-[#d9f3e1] text-[#37352f] dark:bg-group-b-dark dark:text-[#c8dccf]',
  C: 'bg-[#dcecfa] text-[#37352f] dark:bg-group-c-dark dark:text-[#c8d6e6]',
  D: 'bg-[#ffe8d4] text-[#37352f] dark:bg-group-d-dark dark:text-[#e6d8ca]',
}

const ROW_BG = {
  A: 'bg-[#e6e0f5] dark:bg-group-a-dark',
  B: 'bg-[#d9f3e1] dark:bg-group-b-dark',
  C: 'bg-[#dcecfa] dark:bg-group-c-dark',
  D: 'bg-[#ffe8d4] dark:bg-group-d-dark',
}

const ROW_HOVER = {
  A: 'transition-colors hover:bg-[#f3effb] dark:hover:bg-group-a-dark-hover',
  B: 'transition-colors hover:bg-[#ecf9f0] dark:hover:bg-group-b-dark-hover',
  C: 'transition-colors hover:bg-[#eef6fd] dark:hover:bg-group-c-dark-hover',
  D: 'transition-colors hover:bg-[#fff4ea] dark:hover:bg-group-d-dark-hover',
}

// 标签/徽章（组名、组别 chip）
export function groupChipClass(groupId) {
  return CHIP[groupId] || ''
}

// 出线行背景
export function groupRowClass(groupId) {
  return ROW_BG[groupId] || ROW_BG.A
}

// 出线行悬停
export function groupRowHoverClass(groupId) {
  return ROW_HOVER[groupId] || ROW_HOVER.A
}
