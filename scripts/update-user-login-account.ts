import { Prisma } from '@prisma/client'
import { maskLoginAccount, maskUserId, normalizeLoginAccount, validateLoginAccountValue } from '../lib/login-account'
import { createNotificationWithDb } from '../lib/notification-write'
import { formatUid } from '../lib/uid'
import { getScriptPrisma } from './script-prisma'

type UserRow = { id: string; uid: number; username: string; role: string }
const args = process.argv.slice(2)
const argument = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined }
const apply = args.includes('--apply')
const targetUid = argument('--target-uid')
const operatorUid = argument('--operator-uid')
const requestedAccount = argument('--account')
const reason = argument('--reason')?.trim().slice(0, 300)

if (!targetUid || !operatorUid || requestedAccount === undefined || !reason) {
  throw new Error('必须提供 --target-uid、--operator-uid、--account 和 --reason；只有额外提供 --apply 才会执行修改')
}

async function main() {
  const prisma = await getScriptPrisma()
  const next = validateLoginAccountValue(requestedAccount)
  if (next.error) throw new Error(next.error)
  const rows = await prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT id, uid, username, role::text FROM "User" ORDER BY uid`)
  const target = rows.find((row) => formatUid(row.uid) === targetUid!.padStart(5, '0'))
  const operator = rows.find((row) => formatUid(row.uid) === operatorUid!.padStart(5, '0'))
  if (!target) throw new Error('目标 UID 不存在')
  if (!operator || operator.role !== 'SUPER_ADMIN') throw new Error('操作人必须是超级管理员')
  if (normalizeLoginAccount(target.username) === next.usernameNormalized) throw new Error('新账号与原账号相同，账号不区分大小写。')
  const conflict = rows.find((row) => row.id !== target.id && normalizeLoginAccount(row.username) === next.usernameNormalized)
  if (conflict) throw new Error(`账号冲突：UID ${formatUid(conflict.uid)} 已使用同一规范化账号`)

  console.info(JSON.stringify({ mode: apply ? 'apply-requested' : 'dry-run', targetUid: formatUid(target.uid), targetUserId: maskUserId(target.id), previousAccount: maskLoginAccount(target.username), nextAccount: maskLoginAccount(next.account), reasonRecorded: true, operatorUid: formatUid(operator.uid) }, null, 2))
  if (!apply) {
    await prisma.$disconnect()
    return
  }

  await prisma.$transaction(async (tx) => {
    const column = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'User' AND column_name = 'usernameNormalized') AS exists`)
    if (column[0]?.exists) {
      await tx.$executeRaw`UPDATE "User" SET username = ${next.account}, "usernameNormalized" = ${next.usernameNormalized} WHERE id = ${target.id}`
    } else {
      await tx.$executeRaw`UPDATE "User" SET username = ${next.account} WHERE id = ${target.id}`
    }
    await createNotificationWithDb(tx, { data: { recipientId: target.id, type: 'SYSTEM', title: '登录账号已由管理员修改', content: '您的登录账号已由超级管理员修改。下次登录时请使用新的登录账号。如非本人申请，请及时联系管理员。', link: '/settings/security' } }, { operation: 'controlled-login-account-change', userId: target.id })
    await tx.adminActionLog.create({ data: { adminId: operator.id, targetUserId: target.id, action: 'USER_ACCOUNT_CHANGED_CONTROLLED_SCRIPT', detail: { previousAccount: maskLoginAccount(target.username), newAccount: maskLoginAccount(next.account), reason } } })
  })
  console.info(JSON.stringify({ mode: 'applied', targetUid: formatUid(target.uid), targetUserId: maskUserId(target.id) }, null, 2))
  await prisma.$disconnect()
}

main()
