import { prisma } from '@/lib/prisma'

/**
 * 演唱会纪念徽章自动授予。
 *
 * 用户在「我的现场」把某场次标记为「我看过」后调用本函数：
 *   1. 查询该场次所属的 MusicTour；
 *   2. 查找该巡演下【启用】的 CONCERT 分类徽章；
 *   3. 通过 UserBadge 的 (userId, badgeId) 唯一约束幂等授予。
 *
 * 设计要点：
 * - 同一巡演的多个不同场次只会获得一次徽章（upsert 兜底，唯一约束拦截重复写入）。
 * - 该巡演未绑定任何启用徽章时不授予（提前返回 false）。
 * - 全程吞掉异常并记录日志，调用方（加入我的现场）绝不会被影响。
 * - 不修改生日徽章 / NotificationType / 用户数据结构 / 我的现场核心逻辑。
 */
export async function checkConcertBadge(userId: string, concertId: string): Promise<boolean> {
  try {
    const concert = await prisma.musicConcert.findUnique({
      where: { id: concertId },
      select: { tourId: true },
    })
    if (!concert?.tourId) return false

    const badge = await prisma.badge.findFirst({
      where: {
        category: 'CONCERT',
        musicTourId: concert.tourId,
        isActive: true,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!badge) return false

    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
      create: { userId, badgeId: badge.id },
      update: {},
    })
    return true
  } catch (error) {
    console.error('[concert-badge.check]', { userId, concertId, error })
    return false
  }
}
