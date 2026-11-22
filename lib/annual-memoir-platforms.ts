export const annualMemoirPlatforms = [
  ['weibo', '微博'],
  ['douyin', '抖音'],
  ['xiaohongshu', '小红书'],
  ['instagram', 'Instagram'],
  ['NETEASE_EASON_FAN_CLUB', '网易云陈奕迅乐迷团'],
] as const

export function isAnnualMemoirPlatform(key: string) {
  return annualMemoirPlatforms.some(([platformKey]) => platformKey === key)
}
