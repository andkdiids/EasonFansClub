import { prisma } from '@/lib/prisma'
import { grantBadge } from '@/lib/badge-service'
import { emitRealtime } from '@/lib/realtime'
import { safeDb } from '@/lib/db-timeout'
import { getShanghaiDateKey, parseBeijingDate } from '@/lib/checkin'
import { runDailyJob } from '@/lib/daily-job-execution'
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
function getBirthdayDateContext(dateKey = getShanghaiDateKey()) {
  const date = parseBeijingDate(dateKey)
  if (!date) throw new Error('INVALID_BIRTHDAY_DATE_KEY')
  return { dateKey, date, ...getTodayMonthDay(date) }
}

export async function countTodayBirthdays(dateKey = getShanghaiDateKey()): Promise<number> {
  const { month, day } = getBirthdayDateContext(dateKey)
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
export async function ensureBirthdayBadge(userId: string, dateKey = getShanghaiDateKey()): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { birthMonth: true, birthDay: true },
    })
    if (!user?.birthMonth || !user?.birthDay) return

    const { month, day } = getBirthdayDateContext(dateKey)
    if (user.birthMonth !== month || user.birthDay !== day) return

    const badge = await prisma.badge.findUnique({
      where: { slug: BIRTHDAY_BADGE_SLUG },
      select: { id: true, isActive: true, isEnabled: true },
    })
    if (!badge || !badge.isActive || !badge.isEnabled) return

    // The unified service owns the existing prisma.userBadge.upsert idempotency contract (userId_badgeId).
    await grantBadge({
      userId,
      badgeId: badge.id,
      sourceType: 'AUTO',
      sourceId: BIRTHDAY_BADGE_SLUG,
      grantReason: '生日自动获得',
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
export async function sendBirthdayGreeting(userId: string, dateKey = getShanghaiDateKey()): Promise<boolean> {
  const { date, month, day } = getBirthdayDateContext(dateKey)
  const year = getShanghaiYear(date)
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
        link: '/birthday-card',
        actorId: null,
      },
    })
    emitRealtime(userId, 'notification')
    return true
  } catch (error) {
    console.error('[birthday.sendGreeting]', error)
    return false
  }
}

/**
 * 给今日生日用户的「好友」发送生日提醒（与本人生日纪念通知相互独立）。
 * - 提醒内容提及生日好友昵称，actor 设为生日用户，点击进入其主页 `/user/[uid]`，不打开生日卡片。
 * - 生日公开设置不影响好友提醒：无论 birthdayPublic 是否为 true，均照常发送。
 * - 幂等：以 key = `friend-birthday:${生日用户id}:${year}` + (recipientId) 唯一约束保证同好友同年每个生日用户只提醒一次。
 * - 失败不影响其他流程：整体及单好友异常均被吞掉并记录日志。
 */
export async function sendFriendBirthdayReminders(dateKey = getShanghaiDateKey()): Promise<void> {
  try {
    const { date, month, day } = getBirthdayDateContext(dateKey)
    const year = getShanghaiYear(date)
    const birthdayUsers = await safeDb(
      'User.findMany birthday.friendReminder.sources',
      prisma.user.findMany({
        where: { status: 'ACTIVE', isDeleted: false, birthMonth: month, birthDay: day },
        select: { id: true, uid: true, nickname: true },
      }),
      [],
      5000,
    )
    if (birthdayUsers.length === 0) return

    const ids = birthdayUsers.map((user) => user.id)
    const friendships = await safeDb(
      'Friendship.findMany birthday.friendReminder',
      prisma.friendship.findMany({
        where: { OR: [{ userAId: { in: ids } }, { userBId: { in: ids } }] },
        select: { userAId: true, userBId: true },
      }),
      [],
      5000,
    )

    for (const source of birthdayUsers) {
      const friendIds = new Set<string>()
      for (const friendship of friendships) {
        if (friendship.userAId === source.id) friendIds.add(friendship.userBId)
        else if (friendship.userBId === source.id) friendIds.add(friendship.userAId)
      }
      for (const friendId of friendIds) {
        try {
          const key = `friend-birthday:${source.id}:${year}`
          const existing = await prisma.notification.findFirst({
            where: { recipientId: friendId, type: 'FRIEND_BIRTHDAY', key },
            select: { id: true },
          })
          if (existing) continue
          await prisma.notification.create({
            data: {
              recipientId: friendId,
              type: 'FRIEND_BIRTHDAY',
              title: '🎂 好友生日',
              content: `🎂 今天是好友 ${source.nickname} 的生日，送上一份祝福吧`,
              key,
              link: `/user/${source.uid}`,
              actorId: source.id,
            },
          })
          emitRealtime(friendId, 'notification')
        } catch (error) {
          console.error('[birthday.friendReminder.user]', friendId, error)
        }
      }
    }
  } catch (error) {
    console.error('[birthday.sendFriendBirthdayReminders]', error)
  }
}

/**
 * 统一生日奖励服务：扫描今天过生日的有效用户，逐个授予「生日纪念」徽章并发送生日祝福通知，
 * 同时给这些生日用户的「好友」发送生日提醒。
 * - 幂等：徽章靠 UserBadge(userId, badgeId) 唯一约束，通知靠 key 唯一约束，重复执行安全。
 * - 失败不影响调用方：整体及单用户异常均被吞掉并记录日志。
 * - 由受保护的内部每日任务调用；重复执行由通知、徽章唯一约束共同保证安全。
 */
export async function grantTodayBirthdayRewards(dateKey = getShanghaiDateKey()): Promise<void> {
  try {
    const { month, day } = getBirthdayDateContext(dateKey)
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
        await ensureBirthdayBadge(user.id, dateKey)
        await sendBirthdayGreeting(user.id, dateKey)
      } catch (error) {
        console.error('[birthday.grantRewards.user]', user.id, error)
      }
    }

    // 好友生日提醒与本人生日通知相互独立：即便上面没有任何生日用户，也由内部自行短路。
    await sendFriendBirthdayReminders(dateKey)
  } catch (error) {
    console.error('[birthday.grantTodayBirthdayRewards]', error)
  }
}

export function runDailyBirthdayRewards(dateKey = getShanghaiDateKey()) {
  return runDailyJob({
    jobKey: 'birthday-rewards',
    dateKey,
    run: () => grantTodayBirthdayRewards(dateKey),
  })
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
