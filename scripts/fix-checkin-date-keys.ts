/**
 * 一次性历史数据修复:校正错位一天的 CheckIn.checkinDateKey
 *
 * 背景:2026-07-18 之前旧版日期 key 生成逻辑错误,部分历史记录的
 * checkinDateKey 比实际北京时间签到日期(checkDate)早一天。
 * 代码已修复上线,本脚本只回填历史数据。
 *
 * 安全约定:
 * - 默认 dry-run,只输出审计结果,不写数据库。
 * - 只有显式传入 --apply 才会执行更新。
 * - 只更新 checkinDateKey,不碰 checkDate / createdAt / streakDay / 积分 / 经验等任何其它字段。
 * - 修正后若同一用户同一日期出现重复(真实冲突),整体停止,不覆盖、不删除、不合并。
 *
 * 用法:
 *   pnpm tsx scripts/fix-checkin-date-keys.ts          # dry-run
 *   pnpm tsx scripts/fix-checkin-date-keys.ts --apply  # 正式执行
 */
import { loadEnvFile } from 'node:process'

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  loadEnvFile('.env')
}

import { prisma } from '../lib/prisma'
import { calculateCheckinStreaks, getShanghaiDateKey } from '../lib/checkin'

const APPLY = process.argv.includes('--apply')
const TEMP_KEY_PREFIX = '__fixing__'

const beijingDateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

function formatBeijing(date: Date) {
  return beijingDateTime.format(date)
}

type CheckInRow = {
  id: string
  userId: string
  checkinDateKey: string
  checkDate: Date
  createdAt: Date
}

type FixItem = {
  row: CheckInRow
  expectedDateKey: string
}

/** schema 中没有 checkedAt 字段,签到时间就是 checkDate,createdAt 兜底 */
function expectedKeyOf(row: CheckInRow) {
  const source = row.checkDate ?? row.createdAt
  return getShanghaiDateKey(source)
}

async function loadAll() {
  return prisma.checkIn.findMany({
    select: { id: true, userId: true, checkinDateKey: true, checkDate: true, createdAt: true },
    orderBy: [{ userId: 'asc' }, { checkinDateKey: 'asc' }],
  })
}

function findFixItems(rows: CheckInRow[]): FixItem[] {
  return rows
    .map((row) => ({ row, expectedDateKey: expectedKeyOf(row) }))
    .filter((item) => item.row.checkinDateKey !== item.expectedDateKey)
}

/**
 * 真实冲突:全部按 expectedDateKey 修正后,同一用户同一日期存在多于一条记录。
 * 注意区分“链式错位”:目标 key 当前被同用户另一条【同样会被移走的】记录占用,
 * 这不属于真实冲突,通过事务内两阶段更新(先临时 key 再目标 key)即可安全完成。
 */
function findConflicts(rows: CheckInRow[], fixItems: FixItem[]) {
  const fixById = new Map(fixItems.map((item) => [item.row.id, item.expectedDateKey]))
  const finalKeyByUser = new Map<string, Map<string, CheckInRow[]>>()
  for (const row of rows) {
    const finalKey = fixById.get(row.id) ?? row.checkinDateKey
    const byKey = finalKeyByUser.get(row.userId) ?? new Map<string, CheckInRow[]>()
    const list = byKey.get(finalKey) ?? []
    list.push(row)
    byKey.set(finalKey, list)
    finalKeyByUser.set(row.userId, byKey)
  }
  const conflicts: { userId: string; finalKey: string; records: CheckInRow[] }[] = []
  for (const [userId, byKey] of finalKeyByUser) {
    for (const [finalKey, records] of byKey) {
      if (records.length > 1) conflicts.push({ userId, finalKey, records })
    }
  }
  return conflicts
}

/** 链式错位提示:目标 key 当前被同用户另一条待修复记录占用(非真实冲突) */
function findChainOverlaps(fixItems: FixItem[]) {
  const fixById = new Map(fixItems.map((item) => [item.row.id, item]))
  const keyOwnerByUser = new Map<string, Map<string, FixItem>>()
  for (const item of fixItems) {
    const byKey = keyOwnerByUser.get(item.row.userId) ?? new Map<string, FixItem>()
    byKey.set(item.row.checkinDateKey, item)
    keyOwnerByUser.set(item.row.userId, byKey)
  }
  const overlaps: { item: FixItem; occupiedBy: FixItem }[] = []
  for (const item of fixItems) {
    const occupant = keyOwnerByUser.get(item.row.userId)?.get(item.expectedDateKey)
    if (occupant && fixById.has(occupant.row.id) && occupant.row.id !== item.row.id) {
      overlaps.push({ item, occupiedBy: occupant })
    }
  }
  return overlaps
}

function printStreaks(label: string, keys: string[]) {
  const streaks = calculateCheckinStreaks(keys)
  console.log(`    ${label}: currentStreak=${streaks.currentStreak} longestStreak=${streaks.longestStreak} totalDays=${streaks.totalDays}`)
  return streaks
}

async function main() {
  console.log(`模式: ${APPLY ? '--apply(正式执行)' : 'dry-run(只审计,不写数据库)'}\n`)

  const rows = await loadAll()
  const fixItems = findFixItems(rows)
  const conflicts = findConflicts(rows, fixItems)
  const chainOverlaps = findChainOverlaps(fixItems)

  console.log('========== 差异明细 ==========')
  for (const { row, expectedDateKey } of fixItems) {
    console.log(
      [
        `id=${row.id}`,
        `userId=${row.userId}`,
        `key: ${row.checkinDateKey} -> ${expectedDateKey}`,
        `checkDate UTC=${row.checkDate.toISOString()} 北京=${formatBeijing(row.checkDate)}`,
        `createdAt UTC=${row.createdAt.toISOString()} 北京=${formatBeijing(row.createdAt)}`,
      ].join('\n  '),
    )
  }
  if (!fixItems.length) console.log('(无差异)')

  console.log('\n========== 汇总 ==========')
  console.log(`扫描总记录数: ${rows.length}`)
  console.log(`日期一致: ${rows.length - fixItems.length}`)
  console.log(`日期不一致(待修复): ${fixItems.length}`)
  const affectedUserIds = [...new Set(fixItems.map((item) => item.row.userId))]
  console.log(`涉及用户数: ${affectedUserIds.length}`)

  const groups = new Map<string, number>()
  for (const item of fixItems) {
    const group = `${item.row.checkinDateKey} -> ${item.expectedDateKey}`
    groups.set(group, (groups.get(group) ?? 0) + 1)
  }
  console.log('按 原日期 -> 目标日期 分组:')
  for (const [group, count] of [...groups.entries()].sort()) {
    console.log(`  ${group}: ${count} 条`)
  }

  console.log('\n========== 冲突检测 ==========')
  if (conflicts.length) {
    console.log(`发现 ${conflicts.length} 组真实冲突(修正后同用户同日期重复),--apply 将整体停止:`)
    for (const conflict of conflicts) {
      console.log(`  userId=${conflict.userId} 目标日期=${conflict.finalKey}`)
      for (const record of conflict.records) {
        console.log(`    记录 id=${record.id} 当前 key=${record.checkinDateKey}`)
      }
    }
  } else {
    console.log('无真实冲突(修正后不存在同用户同日期重复)。')
  }
  if (chainOverlaps.length) {
    console.log(`链式错位 ${chainOverlaps.length} 处(目标 key 被同用户另一条待修复记录暂占,事务内两阶段更新即可安全处理,非冲突):`)
    for (const { item, occupiedBy } of chainOverlaps) {
      console.log(
        `  记录 ${item.row.id} (${item.row.checkinDateKey} -> ${item.expectedDateKey}) 的目标 key 暂被记录 ${occupiedBy.row.id} (${occupiedBy.row.checkinDateKey} -> ${occupiedBy.expectedDateKey}) 占用`,
      )
    }
  }

  console.log('\n========== 受影响用户连签变化(按修正前后 key 模拟重算) ==========')
  const rowsByUser = new Map<string, CheckInRow[]>()
  for (const row of rows) {
    const list = rowsByUser.get(row.userId) ?? []
    list.push(row)
    rowsByUser.set(row.userId, list)
  }
  const fixById = new Map(fixItems.map((item) => [item.row.id, item.expectedDateKey]))
  for (const userId of affectedUserIds) {
    const userRows = rowsByUser.get(userId) ?? []
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true, username: true } })
    const beforeKeys = userRows.map((row) => row.checkinDateKey)
    const afterKeys = userRows.map((row) => fixById.get(row.id) ?? row.checkinDateKey)
    console.log(`  用户 ${user?.username ?? '?'} (uid=${user?.uid ?? '?'}, id=${userId})`)
    printStreaks('修复前', beforeKeys)
    printStreaks('修复后', afterKeys)
  }

  const uid9Rows = rowsByUser.get((await prisma.user.findFirst({ where: { uid: 9 }, select: { id: true } }))?.id ?? '')
  if (uid9Rows) {
    console.log('\n========== UID 00009 专项 ==========')
    for (const row of uid9Rows) {
      const expected = fixById.get(row.id)
      console.log(
        `  ${row.checkinDateKey}${expected ? ` -> ${expected}` : ' (不变)'}  | checkDate 北京=${formatBeijing(row.checkDate)}`,
      )
    }
  }

  if (!APPLY) {
    console.log('\ndry-run 完成,未修改数据库。确认无误后使用 --apply 正式执行。')
    return
  }

  console.log('\n========== 正式执行 ==========')
  if (conflicts.length) {
    console.error('存在真实冲突,已整体停止,未做任何修改。请人工处理冲突后重试。')
    process.exitCode = 1
    return
  }
  if (!fixItems.length) {
    console.log('没有需要修复的记录,结束。')
    return
  }

  const beforeStreakSnapshot = new Map<string, string[]>()
  for (const userId of affectedUserIds) {
    beforeStreakSnapshot.set(userId, (rowsByUser.get(userId) ?? []).map((row) => row.checkinDateKey))
  }

 await prisma.$transaction(
  async (tx) => {
    // 第一阶段:全部改为临时 key,避免链式错位造成瞬时唯一键冲突
    for (const item of fixItems) {
      await tx.checkIn.update({
        where: { id: item.row.id },
        data: { checkinDateKey: `${TEMP_KEY_PREFIX}${item.row.id}` },
      })
    }
    // 第二阶段:写入目标 key,只更新 checkinDateKey
    for (const item of fixItems) {
      await tx.checkIn.update({
        where: { id: item.row.id },
        data: {
          checkinDateKey: item.expectedDateKey,
        },
      })
    }
  },
  {
    timeout: 600000,
    maxWait: 60000,
  }
)
  console.log(`已在事务中更新 ${fixItems.length} 条记录的 checkinDateKey。`)

  console.log('\n========== 执行后验证 ==========')
  const verifyRows = await loadAll()
  const stillWrong = verifyRows.filter((row) => row.checkinDateKey !== expectedKeyOf(row))
  console.log(`1) key 与实际北京时间日期一致性: ${verifyRows.length - stillWrong.length}/${verifyRows.length} 正确${stillWrong.length ? `,仍有 ${stillWrong.length} 条异常!` : ''}`)
  if (stillWrong.length) {
    for (const row of stillWrong) console.log(`   异常: id=${row.id} key=${row.checkinDateKey} 应为 ${expectedKeyOf(row)}`)
    process.exitCode = 1
  }

  const dupConflicts = findConflicts(verifyRows, [])
  console.log(`2) 用户+日期重复检查: ${dupConflicts.length ? `发现 ${dupConflicts.length} 组重复!` : '无重复'}`)
  if (dupConflicts.length) process.exitCode = 1

  console.log('3) 受影响用户连签变化(修复前 -> 修复后):')
  const verifyByUser = new Map<string, CheckInRow[]>()
  for (const row of verifyRows) {
    const list = verifyByUser.get(row.userId) ?? []
    list.push(row)
    verifyByUser.set(row.userId, list)
  }
  for (const userId of affectedUserIds) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { uid: true, username: true } })
    console.log(`  用户 ${user?.username ?? '?'} (uid=${user?.uid ?? '?'})`)
    printStreaks('修复前', beforeStreakSnapshot.get(userId) ?? [])
    printStreaks('修复后', (verifyByUser.get(userId) ?? []).map((row) => row.checkinDateKey))
  }

  const uid9 = await prisma.user.findFirst({ where: { uid: 9 }, select: { id: true } })
  if (uid9) {
    console.log('4) UID 00009 修复后记录:')
    for (const row of (verifyByUser.get(uid9.id) ?? [])) {
      console.log(`   ${row.checkinDateKey} | checkDate 北京=${formatBeijing(row.checkDate)}`)
    }
  }
}

main()
  .catch((error) => {
    console.error('脚本执行失败:', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
