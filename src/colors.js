export const colorsBgLight = {
  white: 'bg-white text-black',
  light: 'bg-white text-black dark:bg-slate-900/70 dark:text-white',
  contrast: 'bg-black text-white dark:bg-white dark:text-black',
  success: 'bg-[#1aae39] border-[#1aae39] text-white dark:bg-[#4a8f6b] dark:border-emerald-500',
  danger: 'bg-[#e03131] border-[#e03131] text-white dark:bg-[#9c6a72] dark:border-[#9c6a72]',
  warning: 'bg-[#dd5b00] border-[#dd5b00] text-white dark:bg-[#a08a5c] dark:border-[#a08a5c]',
  info: 'bg-[#0075de] border-[#0075de] text-white dark:bg-[#5a7fa8] dark:border-blue-500',
  purple: 'bg-[#5645d4] border-[#5645d4] text-white dark:bg-[#756b96] dark:border-[#756b96]',
  gold: 'bg-[#d9b45c] border-transparent text-white dark:bg-[#b89335] dark:border-transparent dark:text-white',
  goldSoft:
    'bg-[#c9a24b]/25 border-transparent text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:border-transparent dark:text-[#e4d3a4]',
}

// 仅供本文件的 colorsOutline 使用
const colorsText = {
  white: 'text-black dark:text-[#e6e6e6]',
  light: 'text-gray-700 dark:text-[#a0a0a0]',
  contrast: 'dark:text-white',
  success: 'text-[#1aae39] dark:text-[#6fbe93]',
  danger: 'text-[#e03131] dark:text-[#bd9aa1]',
  warning: 'text-[#dd5b00] dark:text-[#c4b48d]',
  info: 'text-[#0075de] dark:text-[#7fa3c9]',
  purple: 'text-[#5645d4] dark:text-[#b3a8c6]',
  gold: 'text-[#8c6d1f] dark:text-[#d8c48a]',
  goldSoft: 'text-[#8c6d1f] dark:text-[#e4d3a4]',
}

export const colorsOutline = {
  white: [colorsText.white, 'border-gray-100'],
  light: [colorsText.light, 'border-gray-100'],
  contrast: [colorsText.contrast, 'border-gray-900 dark:border-slate-100'],
  success: [colorsText.success, 'border-[#1aae39]'],
  danger: [colorsText.danger, 'border-[#e03131]'],
  warning: [colorsText.warning, 'border-[#dd5b00]'],
  info: [colorsText.info, 'border-[#0075de]'],
  purple: [colorsText.purple, 'border-[#5645d4]'],
  gold: [colorsText.gold, 'border-transparent'],
  goldSoft: [colorsText.goldSoft, 'border-transparent'],
}

// 按钮配色：color 决定底色/描边/文字，hasHover 为 false 时不加悬停样式（禁用态）
export const getButtonColor = (color, hasHover = true) => {
  const colors = {
    ring: {
      white: 'ring-gray-200 dark:ring-gray-500',
      whiteDark: 'ring-gray-200 dark:ring-gray-500',
      lightDark: 'ring-gray-200 dark:ring-gray-500',
      contrast: 'ring-gray-300 dark:ring-gray-400',
      success: 'ring-[#79d98f] dark:ring-[#2f6b4a]',
      danger: 'ring-[#f2a5a5] dark:ring-[#6e4a50]',
      warning: 'ring-[#f2b877] dark:ring-[#7a6a45]',
      info: 'ring-[#7cc0ff] dark:ring-[#35506e]',
      purple: 'ring-[#a89ef0] dark:ring-[#5b5478]',
      gold: 'ring-[#e6c877] dark:ring-[#7a6a45]',
      goldSoft: 'ring-[#e6c877] dark:ring-[#7a6a45]',
    },
    bg: {
      white: 'bg-white text-black',
      whiteDark: 'bg-white text-black dark:bg-[#2a2a2a] dark:text-[#e0e2f0]',
      lightDark: 'bg-gray-100 text-black dark:bg-slate-800 dark:text-white',
      contrast: 'bg-black text-white dark:bg-white dark:text-black',
      success: 'bg-[#1aae39] dark:bg-[#4a8f6b] text-white',
      danger: 'bg-[#e03131] text-white dark:bg-[#9c6a72]',
      warning: 'bg-[#dd5b00] text-white dark:bg-[#a08a5c]',
      info: 'bg-[#0075de] dark:bg-[#5a7fa8] text-white',
      purple: 'bg-[#5645d4] text-white dark:bg-[#756b96]',
      gold: 'bg-[#d9b45c] text-white dark:bg-[#b89335] dark:text-white',
      goldSoft: 'bg-[#c9a24b]/25 text-[#8c6d1f] dark:bg-[#c9a24b]/25 dark:text-[#e4d3a4]',
    },
    bgHover: {
      white: 'hover:bg-gray-100',
      whiteDark: 'hover:bg-gray-100 dark:hover:bg-[#3d3d3d]',
      lightDark: 'hover:bg-gray-200 dark:hover:bg-slate-700',
      contrast: 'hover:bg-gray-700 dark:hover:bg-slate-100',
      success:
        'hover:bg-[#12902d] hover:border-[#12902d] dark:hover:bg-[#3f7a5c] dark:hover:border-[#3f7a5c]',
      danger:
        'hover:bg-[#b52323] hover:border-[#b52323] dark:hover:bg-[#8e5660] dark:hover:border-[#8a5f66]',
      warning:
        'hover:bg-[#a84600] hover:border-[#a84600] dark:hover:bg-[#96753c] dark:hover:border-[#8f7c52]',
      info: 'hover:bg-[#005bab] hover:border-[#005bab] dark:hover:bg-[#4a6b91] dark:hover:border-[#4a6b91]',
      purple:
        'hover:bg-[#4534b3] hover:border-[#4534b3] dark:hover:bg-[#666080] dark:hover:border-[#666080]',
      gold: 'hover:brightness-95 dark:hover:brightness-95',
      goldSoft: 'hover:bg-[#c9a24b]/40 dark:hover:bg-[#c9a24b]/40',
    },
    borders: {
      white: 'border-[#c8c4be]',
      whiteDark: 'border-[#c8c4be] dark:border-[#454545]',
      lightDark: 'border-[#c8c4be] dark:border-[#3d3d3d]',
      contrast: 'border-black dark:border-white',
      success: 'border-[#1aae39] dark:border-emerald-500',
      danger: 'border-[#e03131] dark:border-[#9c6a72]',
      warning: 'border-[#dd5b00] dark:border-[#a08a5c]',
      info: 'border-[#0075de] dark:border-blue-500',
      purple: 'border-[#5645d4] dark:border-[#756b96]',
      gold: 'border-transparent dark:border-transparent',
      goldSoft: 'border-transparent dark:border-transparent',
    },
  }

  if (!colors.bg[color]) {
    return color
  }

  const base = [colors.borders[color], colors.ring[color], colors.bg[color]]
  if (hasHover) base.push(colors.bgHover[color])

  return base
}
