/**
 * 一次性清理脚本：删除因历史 Bug 误发送的 BIRTHDAY_GREETING 通知。
 *
 * 背景：此前 sendBirthdayGreeting 在登录链路被无条件调用且未校验生日，
 * 导致未填生日 / 非当天生日的用户也收到了生日通知。代码已修复，
 * 本脚本清理历史错误通知（仅删除「无效」通知，保留真实生日通知）。
 *
 * 有效性规则（严格按需求）：
 *   有效 = 收件人 birthMonth 与 birthDay 均非空，且分别等于
 *          「通知创建时间（Asia/Shanghai 时区）」的月份与日期。
 *   无效 = 以下任一：birthMonth 为 null / birthDay 为 null / 月份不匹配 / 日期不匹配。
 *
 * 安全约束：
 *   - 默认仅统计并输出明细，不执行任何删除（DRY RUN / 只读）。
 *   - 仅在设置环境变量 ENABLE_DELETE=true 时执行删除。
 *   - 删除使用 deleteMany，where 同时限定 type='BIRTHDAY_GREETING' 与 id IN 无效列表，
 *     绝不会删除其他 NotificationType、不会改表结构、不会改用户生日字段、不会动徽章逻辑。
 *   - 不删除历史通知中「有效」的部分，不与修复后的逻辑冲突。
 *
 * 用法：
 *   pnpm exec tsx scripts/cleanup-invalid-birthday-notifications.ts
 *     -> 仅统计并输出错误通知数量 / ID / 用户 / 创建时间，不删除。
 *   ENABLE_DELETE=true pnpm exec tsx scripts/cleanup-invalid-birthday-notifications.ts
 *     -> 在确认无误后，删除无效通知并输出删除数量。
 */

import { prisma } from '../lib/prisma'

const ENABLE_DELETE = process.env.ENABLE_DELETE === 'true'

/** 以 Asia/Shanghai 时区计算给定时间的月份与日期。 */
function getShanghaiMonthDay(date: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const day = Number(parts.find((p) => p.type === 'day')?.value)
  return { month, day }
}

/** 以 Asia/Shanghai 时区格式化时间为 YYYY-MM-DD HH:MM:SS 便于阅读。 */
function formatShanghai(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

async function main() {
  console.log(`[模式] ${ENABLE_DELETE ? '执行删除' : '只读统计（DRY RUN，不删除）'}`)
  console.log('开始查询 BIRTHDAY_GREETING 通知...')

  const notifications = await prisma.notification.findMany({
    where: { type: 'BIRTHDAY_GREETING' },
    select: { id: true, recipientId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const total = notifications.length
  console.log(`查询到 BIRTHDAY_GREETING 通知：${total} 条`)

  if (total === 0) {
    console.log('无数据，结束。')
    return
  }

  // 批量拉取收件人信息，避免 N+1 查询。
  const userIds = Array.from(new Set(notifications.map((n) => n.recipientId)))
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, nickname: true, birthMonth: true, birthDay: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u]))

  type InvalidRow = {
    id: string
    uid: string
    nickname: string | null
    createdAt: Date
    reason: string
  }
  const invalid: InvalidRow[] = []

  for (const n of notifications) {
    const { month, day } = getShanghaiMonthDay(n.createdAt)
    const user = userMap.get(n.recipientId)
    let reason = ''
    let valid = false

    if (!user) {
      reason = '收件用户不存在（跳过删除以保留审计）'
    } else if (user.birthMonth === null || user.birthDay === null) {
      reason = '用户未设置生日（birthMonth/birthDay 为 null）'
    } else if (user.birthMonth !== month || user.birthDay !== day) {
      reason = `生日不匹配（用户 ${user.birthMonth}/${user.birthDay} ≠ 发送日 ${month}/${day}）`
    } else {
      valid = true
    }

    if (!valid) {
      invalid.push({
        id: n.id,
        uid: n.recipientId,
        nickname: user?.nickname ?? null,
        createdAt: n.createdAt,
        reason,
      })
    }
  }

  const invalidCount = invalid.length
  const validCount = total - invalidCount

  console.log(`判定无效（应删除）：${invalidCount} 条`)
  console.log(`判定有效（保留）：${validCount} 条`)

  if (invalidCount > 0) {
    console.log('\n--- 无效通知明细 ---')
    for (const r of invalid) {
      console.log(
        `ID=${r.id} | UID=${r.uid} | 昵称=${r.nickname ?? '(无)'} | 创建=${formatShanghai(r.createdAt)} | 原因=${r.reason}`,
      )
    }
  }

  if (!ENABLE_DELETE) {
    console.log(
      `\n[DRY RUN] 未删除任何数据。确认以上明细无误后，使用 ENABLE_DELETE=true 重新执行以删除 ${invalidCount} 条无效通知。`,
    )
    return
  }

  const ids = invalid
    .filter((r) => r.reason !== '收件用户不存在（跳过删除以保留审计）')
    .map((r) => r.id)

  if (ids.length === 0) {
    console.log('\n[DELETE] 没有需要删除的无效通知（或已全部为不可删除项）。')
    return
  }

  const result = await prisma.notification.deleteMany({
    where: { id: { in: ids }, type: 'BIRTHDAY_GREETING' },
  })

  console.log(`\n[DELETE] 实际删除无效通知：${result.count} 条`)
  console.log(`[保留] 有效生日通知：${validCount} 条（未被删除）`)
}

main()
  .catch((e) => {
    console.error('执行失败：', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
