import { Prisma } from '@prisma/client'
import { normalizeLoginAccount, maskLoginAccount, maskUserId, validateLoginAccountValue } from '../lib/login-account'
import { formatUid } from '../lib/uid'
import { getScriptPrisma } from './script-prisma'

type UserRow = { id: string; uid: number; username: string | null }
type GroupKey = 'exact' | 'trimmed' | 'nfkc' | 'lower' | 'normalized'

function groupConflicts(rows: UserRow[], valueFor: (row: UserRow) => string | null) {
  const groups = new Map<string, UserRow[]>()
  for (const row of rows) {
    const value = valueFor(row)
    if (value === null) continue
    groups.set(value, [...(groups.get(value) || []), row])
  }
  return [...groups.entries()].filter(([, users]) => users.length > 1).map(([value, users]) => ({
    maskedUsername: maskLoginAccount(value),
    count: users.length,
    uids: users.map((user) => formatUid(user.uid)),
    userIds: users.map((user) => maskUserId(user.id)),
  }))
}

async function main() {
  const prisma = await getScriptPrisma()
  const rows = await prisma.$queryRaw<UserRow[]>(Prisma.sql`SELECT id, uid, username FROM "User" ORDER BY uid`)
  const conflicts: Record<GroupKey, ReturnType<typeof groupConflicts>> = {
    exact: groupConflicts(rows, (row) => row.username),
    trimmed: groupConflicts(rows, (row) => row.username?.trim() ?? null),
    nfkc: groupConflicts(rows, (row) => row.username?.trim().normalize('NFKC') ?? null),
    lower: groupConflicts(rows, (row) => row.username?.trim().toLowerCase() ?? null),
    normalized: groupConflicts(rows, (row) => row.username === null ? null : normalizeLoginAccount(row.username)),
  }
  const invalid = rows.flatMap((row) => {
    const result = validateLoginAccountValue(row.username)
    const reasons = [
      ...(row.username === null ? ['NULL'] : []),
      ...(row.username === '' ? ['EMPTY'] : []),
      ...(row.username !== null && row.username !== row.username.trim() ? ['EDGE_WHITESPACE'] : []),
      ...(result.error ? ['INVALID_LENGTH_OR_EMPTY'] : []),
    ]
    return reasons.length ? [{ uid: formatUid(row.uid), userId: maskUserId(row.id), maskedUsername: maskLoginAccount(row.username || ''), reasons }] : []
  })
  const blocked = invalid.length > 0 || Object.values(conflicts).some((groups) => groups.length > 0)
  console.info(JSON.stringify({ mode: 'read-only', usersScanned: rows.length, blocked, invalid, conflicts, forbiddenFieldsSelected: [] }, null, 2))
  if (blocked) process.exitCode = 2
  await prisma.$disconnect()
}

main()
