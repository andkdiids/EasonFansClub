export const defaultGrowthLevels = [
  { level: 1, name: '初入E院', requiredExp: 0 },
  { level: 2, name: '观察期', requiredExp: 1000 },
  { level: 3, name: '稳定治疗', requiredExp: 3000 },
  { level: 4, name: '长期住院', requiredExp: 7000 },
  { level: 5, name: '资深病友', requiredExp: 12000 },
  { level: 6, name: '核心成员', requiredExp: 18000 },
  { level: 7, name: '终身病友', requiredExp: 25000 },
] as const

export function resolveGrowthLevelName(level?: number | null, configuredName?: string | null) {
  const safeConfiguredName = String(configuredName || '').trim()
  if (safeConfiguredName) return safeConfiguredName
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1))
  return defaultGrowthLevels.find((item) => item.level === safeLevel)?.name || defaultGrowthLevels[0].name
}
