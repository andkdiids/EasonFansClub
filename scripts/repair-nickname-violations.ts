/**
 * 数据修复脚本（需求 八）：为存量「昵称违规」用户批量生成唯一展示昵称。
 *
 * 背景：旧逻辑把所有违规昵称统一存成字面量「违规昵称」，既无唯一性也无生成记录。
 * 本脚本找出 nicknameModerationStatus = 'VIOLATION' 且 nicknameViolationDisplay 为空的记录，
 * 为其生成全局唯一的「违规昵称」+ 8 位随机串，并补写一条 NicknameViolationLog（reason = DATA_REPAIR）。
 *
 * 运行（需可写数据库权限，建议在低峰期执行）：
 *   pnpm nickname:repair
 * 或
 *   tsx scripts/repair-nickname-violations.ts
 */
import { loadEnvFile } from 'node:process'
import type { NicknameUniquenessClient } from '../lib/nickname-violation'

const BATCH_SIZE = 200

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ prisma }] = await Promise.all([import('../lib/prisma')])
  const { generateUniqueViolationNickname } = await import('../lib/nickname-violation')
  const client = prisma as unknown as NicknameUniquenessClient

  let repaired = 0

  for (let skip = 0; ; skip += BATCH_SIZE) {
    const users = await prisma.user.findMany({
      where: { nicknameModerationStatus: 'VIOLATION', nicknameViolationDisplay: null },
      orderBy: { id: 'asc' },
      skip,
      take: BATCH_SIZE,
      select: { id: true, nickname: true, nicknameViolationCount: true },
    })
    if (!users.length) break

    for (const user of users) {
      const count = (user.nicknameViolationCount || 0) + 1
      const display = await generateUniqueViolationNickname(client, Math.random)
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { nicknameViolationDisplay: display, nicknameViolationCount: count },
        })
        await tx.nicknameViolationLog.create({
          data: {
            userId: user.id,
            originalNickname: user.nickname,
            reason: 'DATA_REPAIR',
            generatedDisplayName: display,
            violationCount: count,
          },
        })
      })
      repaired += 1
      console.info(`[repair] ${user.id} -> ${display} (count=${count})`)
    }
  }

  console.info(`[repair] done. repaired=${repaired}`)
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[nickname:repair] failed', error)
  process.exitCode = 1
})
