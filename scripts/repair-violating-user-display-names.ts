/**
 * 修复历史违规用户展示名异常（问题 1 / 2）。
 *
 * 背景：旧扫描逻辑只把用户标记为违规（nicknameModerationStatus='VIOLATION' 与
 * Profile.displayNameModerationStatus='VIOLATION'），却未生成唯一安全展示昵称，
 * 导致 getPublicUserDisplayName 兜底显示「违规用户」。且用户改回合法昵称后
 * Profile 残留标记未被清除，仍显示「违规用户」。
 *
 * 处理（不删除任何数据）：
 *   情况A：当前昵称仍命中违禁词 → 生成唯一安全展示昵称 + 写 NicknameViolationLog(DATA_REPAIR)
 *   情况B：当前昵称已合法 → 清除违规状态，恢复 displayName = nickname
 *
 * 运行：
 *   node --import tsx scripts/repair-violating-user-display-names.ts
 */
import { loadEnvFile } from 'node:process'
import type { NicknameUniquenessClient } from '../lib/nickname-violation'

const BATCH_SIZE = 200

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { generateUniqueViolationNickname } = await import('../lib/nickname-violation')
  const { checkBannedWords } = await import('../lib/content-moderation')
  const client = prisma as unknown as NicknameUniquenessClient

  let keepViolation = 0
  let restoreNormal = 0

  for (let skip = 0; ; skip += BATCH_SIZE) {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { nicknameModerationStatus: 'VIOLATION' },
          { Profile: { is: { displayNameModerationStatus: 'VIOLATION' } } },
        ],
      },
      orderBy: { uid: 'asc' },
      skip,
      take: BATCH_SIZE,
      select: {
        id: true,
        uid: true,
        nickname: true,
        nicknameModerationStatus: true,
        nicknameViolationDisplay: true,
        nicknameViolationCount: true,
        Profile: { select: { id: true, displayName: true, displayNameModerationStatus: true } },
      },
    })
    if (!users.length) break

    for (const user of users) {
      const currentNickname = user.nickname || ''
      const blocked = (await checkBannedWords(currentNickname)).blocked
      const beforeDisplay = user.nicknameViolationDisplay || (user.nicknameModerationStatus === 'VIOLATION' ? '违规用户' : (user.Profile?.displayName || currentNickname))

      let type: string
      let afterDisplay: string

      if (blocked) {
        // 情况A：当前昵称仍违规 → 生成唯一安全展示昵称
        const count = (user.nicknameViolationCount || 0) + 1
        const display = await generateUniqueViolationNickname(client, Math.random)
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { nicknameModerationStatus: 'VIOLATION', nicknameViolationDisplay: display, nicknameViolationCount: count },
          })
          await tx.nicknameViolationLog.create({
            data: { userId: user.id, originalNickname: currentNickname, reason: 'DATA_REPAIR', generatedDisplayName: display, violationCount: count },
          })
          if (user.Profile) {
            await tx.profile.update({ where: { id: user.Profile.id }, data: { displayNameModerationStatus: 'NORMAL' } })
          }
        })
        type = 'KEEP_VIOLATION'
        afterDisplay = display
        keepViolation += 1
      } else {
        // 情况B：当前昵称已合法 → 恢复正常展示
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { nicknameModerationStatus: 'NORMAL', nicknameViolationDisplay: null },
          })
          if (user.Profile) {
            await tx.profile.update({
              where: { id: user.Profile.id },
              data: { displayName: currentNickname, displayNameModerationStatus: 'NORMAL' },
            })
          }
          const openLog = await tx.nicknameViolationLog.findFirst({
            where: { userId: user.id, resolvedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          })
          if (openLog) {
            await tx.nicknameViolationLog.update({ where: { id: openLog.id }, data: { resolvedAt: new Date(), resolvedNickname: currentNickname } })
          }
        })
        type = 'NORMAL_RESTORE'
        afterDisplay = currentNickname
        restoreNormal += 1
      }

      console.info(`${user.uid}\t${currentNickname}\t${currentNickname}\t${beforeDisplay}\t${afterDisplay}\t${type}`)
    }
  }

  console.info(`[repair] done. KEEP_VIOLATION=${keepViolation} NORMAL_RESTORE=${restoreNormal}`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[repair-violating-user-display-names] failed', error)
  process.exitCode = 1
})
