export function memoirIdentity(stats: {
  posts: number; replies: number; friends: number; interactions: number; games: number
  badges: number; activities: number; activeDays: number
}) {
  const focus = [
    [stats.posts >= 5, '故事记录者'],
    [stats.friends >= 3 || stats.interactions >= 6, '最佳损友'],
    [stats.games >= 5, '游戏冒险家'],
    [stats.badges >= 3, '勋章收藏家'],
    [stats.activities >= 3, '活动探索家'],
  ] as const
  if (focus.filter(([qualified]) => qualified).length >= 3 || (stats.posts >= 3 && stats.replies >= 10)) return 'E院气氛担当'
  return focus.find(([qualified]) => qualified)?.[1] ?? (Object.values(stats).some(Boolean) ? '默默陪伴者' : '故事刚刚开始')
}
