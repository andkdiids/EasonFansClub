import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

/**
 * 清理历史 Supabase Storage 头像 / 背景图地址。
 *
 * 背景：项目已迁移到腾讯云 COS，旧 Supabase 项目不可访问，
 * 历史 User/Profile 中的 Supabase 图片地址一律视为失效，清空为 NULL，
 * 前端会统一回退到默认头像 / 默认背景。
 *
 * 用法：
 *   pnpm tsx scripts/cleanup-supabase-profile-images.ts            先打印数量，再执行清理
 *   pnpm tsx scripts/cleanup-supabase-profile-images.ts --dry-run  只统计，不修改
 *
 * 可重复执行（幂等）：已清空的字段不会再次被统计。
 */

const prisma = new PrismaClient()

const dryRun = process.argv.includes('--dry-run')

const supabaseWhere = (field: 'avatarUrl' | 'backgroundUrl') => ({
  OR: [
    { [field]: { contains: 'supabase.co' } },
    { [field]: { contains: 'supabase.in' } },
    { [field]: { contains: 'storage/v1/object' } },
  ],
})

async function main() {
  const [
    userAvatarCount,
    userBackgroundCount,
    profileAvatarCount,
    profileBackgroundCount,
  ] = await Promise.all([
    prisma.user.count({ where: supabaseWhere('avatarUrl') }),
    prisma.user.count({ where: supabaseWhere('backgroundUrl') }),
    prisma.profile.count({ where: supabaseWhere('avatarUrl') }),
    prisma.profile.count({ where: supabaseWhere('backgroundUrl') }),
  ])

  const avatarTotal = userAvatarCount + profileAvatarCount
  const backgroundTotal = userBackgroundCount + profileBackgroundCount

  console.log(`发现头像 ${avatarTotal} 个（User ${userAvatarCount} / Profile ${profileAvatarCount}）`)
  console.log(`发现背景图 ${backgroundTotal} 个（User ${userBackgroundCount} / Profile ${profileBackgroundCount}）`)

  if (dryRun) {
    console.log('dry-run：未执行清理')
    return
  }

  const [
    userAvatarCleaned,
    userBackgroundCleaned,
    profileAvatarCleaned,
    profileBackgroundCleaned,
  ] = await prisma.$transaction([
    prisma.user.updateMany({ where: supabaseWhere('avatarUrl'), data: { avatarUrl: null } }),
    prisma.user.updateMany({ where: supabaseWhere('backgroundUrl'), data: { backgroundUrl: null } }),
    prisma.profile.updateMany({ where: supabaseWhere('avatarUrl'), data: { avatarUrl: null } }),
    prisma.profile.updateMany({ where: supabaseWhere('backgroundUrl'), data: { backgroundUrl: null } }),
  ])

  console.log(`已清理头像 ${userAvatarCleaned.count + profileAvatarCleaned.count} 个（User ${userAvatarCleaned.count} / Profile ${profileAvatarCleaned.count}）`)
  console.log(`已清理背景图 ${userBackgroundCleaned.count + profileBackgroundCleaned.count} 个（User ${userBackgroundCleaned.count} / Profile ${profileBackgroundCleaned.count}）`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
