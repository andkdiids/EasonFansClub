import { loadEnvFile } from 'node:process'
import { maskLoginAccount, maskUserId } from '../lib/login-account'

export type AuditUserRow = {
  id: string
  uid: number
  username: string
  phone: string | null
  email?: string | null
}

export type InternalAccountPhoneRow = {
  userId: string
  uid: number
  internalAccount: string
  phone: string
}

export type EmailAnomalyRow = {
  userId: string
  uid: number
  email: string
}

type ReadonlyAuditPrisma = {
  user: {
    findMany(args: {
      select: { id: true; uid: true; username: true; phone: true; email: true }
      orderBy: { uid: 'asc' }
    }): Promise<AuditUserRow[]>
  }
  $disconnect(): Promise<void>
}

export function findInternalAccountPhoneMatches(rows: AuditUserRow[]): InternalAccountPhoneRow[] {
  return rows.flatMap((row) => {
    const internalAccount = row.username
    if (!row.phone || internalAccount !== row.phone) return []
    return [{
      userId: maskUserId(row.id),
      uid: row.uid,
      internalAccount: maskLoginAccount(internalAccount),
      phone: maskLoginAccount(row.phone),
    }]
  })
}

export function findEmailAnomalies(rows: AuditUserRow[]): EmailAnomalyRow[] {
  const byEmail = new Map<string, AuditUserRow[]>()

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase()
    if (!email) continue
    const group = byEmail.get(email) || []
    group.push(row)
    byEmail.set(email, group)
  }

  return Array.from(byEmail.values())
    .filter((group) => group.length > 1)
    .flatMap((group) => group.map((row) => ({
      userId: maskUserId(row.id),
      uid: row.uid,
      email: maskLoginAccount(row.email!.trim().toLowerCase()),
    })))
}

export function buildAuditReport(
  rows: AuditUserRow[],
) {
  const matches = findInternalAccountPhoneMatches(rows)
  const emailAnomalies = findEmailAnomalies(rows)
  return {
    mode: 'read-only' as const,
    usersScanned: rows.length,
    usernamePhoneAnomalyCount: matches.length,
    matchCount: matches.length,
    matches,
    emailAnomalyCount: emailAnomalies.length,
    emailAnomalies,
    changesApplied: 0,
    needsManualReview: matches.length > 0 || emailAnomalies.length > 0,
    note: matches.length || emailAnomalies.length
      ? '发现疑似历史字段异常；脚本未修改任何数据，请人工确认后处理。日志中的用户标识和联系方式已脱敏。'
      : '未发现 internalAccount 与 phone 完全相同或重复邮箱的用户。',
  }
}

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL')
  // The application client in this workspace is generated for Prisma Data Proxy
  // in some environments. Use the repository's tracked isolated MySQL client so
  // this read-only audit neither depends on that URL mode nor regenerates files.
  const { PrismaClient } = await import('./database-migration/.generated/mysql/index.js')
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl }) as unknown as ReadonlyAuditPrisma
  try {
    const rows = await prisma.user.findMany({
      select: { id: true, uid: true, username: true, phone: true, email: true },
      orderBy: { uid: 'asc' },
    })
    // `internalAccount` is the business name used by the admin UI for User.username.
    // This is deliberately a read-only comparison: no update/delete/raw write is made.
    console.info(JSON.stringify(buildAuditReport(rows), null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

if (process.argv[1] && process.argv[1].endsWith('audit-internal-account-phone.ts')) {
  main().catch((error) => {
    console.error('[audit-internal-account-phone] failed', error)
    process.exitCode = 1
  })
}
