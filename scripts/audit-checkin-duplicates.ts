import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

type DuplicateSummary = { duplicateUsers: bigint; duplicateDates: bigint; recordsToRemove: bigint }

async function main() {
  const [summary] = await prisma.$queryRaw<DuplicateSummary[]>(Prisma.sql`
    WITH grouped AS (
      SELECT "userId", to_char("checkDate" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS date_key, count(*) AS records
      FROM "CheckIn"
      GROUP BY "userId", date_key
      HAVING count(*) > 1
    )
    SELECT
      count(DISTINCT "userId") AS "duplicateUsers",
      count(*) AS "duplicateDates",
      coalesce(sum(records - 1), 0) AS "recordsToRemove"
    FROM grouped
  `)
  console.info(JSON.stringify({
    mode: 'dry-run',
    duplicateUsers: Number(summary?.duplicateUsers || BigInt(0)),
    duplicateDates: Number(summary?.duplicateDates || BigInt(0)),
    recordsToRemove: Number(summary?.recordsToRemove || BigInt(0)),
    note: '该命令只读，不修改挂号费、经验、留言、通知或挂号记录。',
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
