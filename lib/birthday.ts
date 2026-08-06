import { prisma } from '@/lib/prisma'
import { safeDb } from '@/lib/db-timeout'
import { getShanghaiDateKey } from '@/lib/checkin'
import { getTodayMonthDay } from '@/lib/today'

/** 生日祝福通知标题与内容（不出现用户名、不写「祝 xxx 生日快乐」、不写生日日期）。 */
export const BIRTHDAY_GREETING_TITLE = '🎂 生日纪念'
export const BIRTHDAY_GREETING_CONTENT =
  '今天是你的生日，E院为你送上一份生日纪念。愿你继续听喜欢的歌，遇见喜欢的风景。'
const BIRTHDAY_GREETING_KEY_PREFIX = 'birthday-greeting'

export const BIRTHDAY_BADGE_SLUG = 'birthday-commemorative'

/**
 * 从管理员维护的「启用」生日祝福文案池中随机选择一条。
 * - 仅查询 isActive=true 的文案，停用的文案天然被排除在随机池之外。
 * - 文案池为空，或数据库异常时，回退到硬编码的默认标题与内容（与下方常量一致）。
 * - 不泄露用户名 / 生日日期 / 「祝 xxx 生日快乐」。
 */
async function pickBirthdayMessage(): Promise<{ title: string; content: string }> {
  try {
    const messages = await prisma.birthdayMessage.findMany({
      where: { isActive: true },
      select: { title: true, content: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    if (messages.length > 0) {
      const chosen = messages[Math.floor(Math.random() * messages.length)]
      return {
        title: chosen.title?.trim() || BIRTHDAY_GREETING_TITLE,
        content: chosen.content?.trim() || BIRTHDAY_GREETING_CONTENT,
      }
    }
  } catch (error) {
    console.error('[birthday.pickMessage]', error)
  }
  return { title: BIRTHDAY_GREETING_TITLE, content: BIRTHDAY_GREETING_CONTENT }
}

/**
 * 统计今天过生日的有效用户数。
 * 仅使用 birthMonth / birthDay（月、日）匹配，不暴露任何具体用户。
 */
export async function countTodayBirthdays(): Promise<number> {
  const { month, day } = getTodayMonthDay()
  return safeDb(
    'User.count birthdays.today',
    prisma.user.count({
      where: {
        status: 'ACTIVE',
        isDeleted: false,
        birthMonth: month,
        birthDay: day,
      },
    }),
    0,
    5000,
  )
}

/**
 * 若今天是该用户的生日，则授予「生日纪念」徽章。
 * - 幂等：依靠 UserBadge 的 (userId, badgeId) 唯一约束，每年生日只会保留一条。
 * - 不绑定年份：只要月日匹配即授予，因此永久保留。
 * - 失败不抛出，避免影响登录 / 资料页主流程。
 */
export async function ensureBirthdayBadge(userId: string): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { birthMonth: true, birthDay: true },
    })
    if (!user?.birthMonth || !user?.birthDay) return

    const { month, day } = getTodayMonthDay()
    if (user.birthMonth !== month || user.birthDay !== day) return

    const badge = await prisma.badge.findUnique({
      where: { slug: BIRTHDAY_BADGE_SLUG },
      select: { id: true },
    })
    if (!badge) return

    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
      create: { userId, badgeId: badge.id },
      update: {},
    })
  } catch (error) {
    console.error('[birthday.ensureBadge]', error)
  }
}

/** 上海时区当前年份，用于生日祝福「同用户同一年只发一次」的去重 key。 */
function getShanghaiYear(now = new Date()): number {
  return Number(getShanghaiDateKey(now).split('-')[0])
}

/**
 * 给指定用户发送生日祝福通知（若今天是其生日）。
 * - 幂等：以 key = `birthday-greeting-${year}` + (recipientId) 唯一约束保证同用户同一年只发一次；
 *   发送前先查重，命中则跳过。即便发生并发竞态，唯一约束也会拦截重复写入。
 * - 不出现用户名 / 「祝 xxx 生日快乐」/ 生日日期。
 * - 返回 true 表示本次实际新建了通知，false 表示已存在（跳过）。
 */
export async function sendBirthdayGreeting(userId: string): Promise<boolean> {
  const year = getShanghaiYear()
  const key = `${BIRTHDAY_GREETING_KEY_PREFIX}-${year}`
  try {
    // 前置强校验（安全修复）：仅当用户真正设置了生日且今天就是其生日，才允许发送。
    // 根因：登录链路会无条件调用本函数（app/api/auth/login/route.ts），若此处不校验，
    // 所有登录用户（含未设生日、非今日生日）都会收到生日通知。此处的校验对所有调用方兜底。
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { birthMonth: true, birthDay: true },
    })
    if (user?.birthMonth == null || user?.birthDay == null) return false

    const { month, day } = getTodayMonthDay()
    if (user.birthMonth !== month || user.birthDay !== day) return false

    const existing = await prisma.notification.findFirst({
      where: { recipientId: userId, type: 'BIRTHDAY_GREETING', key },
      select: { id: true },
    })
    if (existing) return false

    const { title, content } = await pickBirthdayMessage()

    await prisma.notification.create({
      data: {
        recipientId: userId,
        type: 'BIRTHDAY_GREETING',
        title,
        content,
        key,
        link: '/profile/edit',
        actorId: null,
      },
    })
    return true
  } catch (error) {
    console.error('[birthday.sendGreeting]', error)
    return false
  }
}

/**
 * 统一生日奖励服务：扫描今天过生日的有效用户，逐个授予「生日纪念」徽章并发送生日祝福通知。
 * - 幂等：徽章靠 UserBadge(userId, badgeId) 唯一约束，通知靠 key 唯一约束，重复执行安全。
 * - 失败不影响调用方：整体及单用户异常均被吞掉并记录日志。
 * - 不新增 cron：由首页加载 / 用户登录等现有访问链路触发（见 lib/home-data.ts、login route）。
 */
export async function grantTodayBirthdayRewards(): Promise<void> {
  try {
    const { month, day } = getTodayMonthDay()
    const users = await safeDb(
      'User.findMany birthday.rewards',
      prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          isDeleted: false,
          birthMonth: month,
          birthDay: day,
        },
        select: { id: true },
      }),
      [],
      5000,
    )

    for (const user of users) {
      try {
        await ensureBirthdayBadge(user.id)
        await sendBirthdayGreeting(user.id)
      } catch (error) {
        console.error('[birthday.grantRewards.user]', user.id, error)
      }
    }
  } catch (error) {
    console.error('[birthday.grantTodayBirthdayRewards]', error)
  }
}

/** 已发送的生日祝福通知总数（用于后台统计）。 */
export async function countBirthdayGreetingsSent(): Promise<number> {
  return safeDb(
    'Notification.count birthday.greetings',
    prisma.notification.count({ where: { type: 'BIRTHDAY_GREETING' } }),
    0,
    5000,
  )
}

/** 已发放的「生日纪念」徽章总数（用于后台统计）。 */
export async function countBirthdayBadgesAwarded(): Promise<number> {
  return safeDb(
    'UserBadge.count birthday.badges',
    prisma.userBadge.count({ where: { Badge: { slug: BIRTHDAY_BADGE_SLUG } } }),
    0,
    5000,
  )
}
