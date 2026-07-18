import { createHash } from 'node:crypto'
import { normalizeLoginAccount, validateLoginAccountValue } from '@/lib/login-account'

export type UsernameBackfillUser = { id: string; uid: number; username: string | null }
export type UsernameBackfillMapping = { id: string; normalized: string }

export function prepareUsernameBackfill(rows: UsernameBackfillUser[]) {
  const ids = new Set<string>()
  const uids = new Set<number>()
  const normalizedOwners = new Map<string, UsernameBackfillUser[]>()
  const invalid: Array<{ id: string; uid: number; reason: string }> = []
  let duplicateIds = 0
  let duplicateUids = 0

  for (const row of rows) {
    if (ids.has(row.id)) duplicateIds += 1
    if (uids.has(row.uid)) duplicateUids += 1
    ids.add(row.id)
    uids.add(row.uid)
    const validation = validateLoginAccountValue(row.username)
    if (row.username === null || validation.error || !validation.usernameNormalized) {
      invalid.push({ id: row.id, uid: row.uid, reason: validation.error || '登录账号为空' })
      continue
    }
    normalizedOwners.set(validation.usernameNormalized, [...(normalizedOwners.get(validation.usernameNormalized) || []), row])
  }

  const conflicts = [...normalizedOwners.entries()].filter(([, owners]) => owners.length > 1).map(([normalized, owners]) => ({ normalized, userIds: owners.map((owner) => owner.id), uids: owners.map((owner) => owner.uid) }))
  const mapping = rows.flatMap((row) => row.username === null ? [] : [{ id: row.id, normalized: normalizeLoginAccount(row.username) }])
  const snapshotFingerprint = createHash('sha256').update(JSON.stringify(rows.map((row) => [row.id, row.uid, row.username]))).digest('hex')
  const blocked = invalid.length > 0 || conflicts.length > 0 || duplicateIds > 0 || duplicateUids > 0 || mapping.length !== rows.length

  return { blocked, invalid, conflicts, duplicateIds, duplicateUids, mapping, snapshotFingerprint }
}

export function buildUsernameBatchUpdate(mapping: UsernameBackfillMapping[]) {
  if (!mapping.length) throw new Error('USERNAME_BACKFILL_MAPPING_EMPTY')
  const values: string[] = []
  const parameters: string[] = []
  mapping.forEach((item, index) => {
    values.push(`($${index * 2 + 1}::text, $${index * 2 + 2}::text)`)
    parameters.push(item.id, item.normalized)
  })
  return {
    text: `UPDATE "User" AS u SET "usernameNormalized" = v.normalized FROM (VALUES ${values.join(', ')}) AS v(id, normalized) WHERE u.id = v.id`,
    parameters,
  }
}

export function classifyExistingStaging(rows: Array<{ id: string; usernameNormalized: string | null }>, mapping: UsernameBackfillMapping[]) {
  const expected = new Map(mapping.map((item) => [item.id, item.normalized]))
  const nonNull = rows.filter((row) => row.usernameNormalized !== null).length
  if (nonNull === 0) return 'EMPTY' as const
  if (rows.length === mapping.length && nonNull === rows.length && rows.every((row) => expected.get(row.id) === row.usernameNormalized)) return 'COMPLETE' as const
  return 'PARTIAL_OR_MISMATCHED' as const
}
