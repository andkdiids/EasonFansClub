import { PrismaClient } from '@prisma/client'

const databaseUrl = process.env.EXPLAIN_DATABASE_URL
if (!databaseUrl) throw new Error('仅允许显式设置 EXPLAIN_DATABASE_URL 后运行；不会回退到 DATABASE_URL')

const dateIndex = process.argv.indexOf('--date-key')
const dateKey = dateIndex >= 0 ? process.argv[dateIndex + 1] : undefined
if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('请提供 --date-key YYYY-MM-DD')
const labelIndex = process.argv.indexOf('--label')
const label = labelIndex >= 0 ? process.argv[labelIndex + 1] || 'current' : 'current'

const prisma = new PrismaClient({ datasourceUrl: databaseUrl, log: ['error'] })

async function main() {
  const countExplain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    EXPLAIN SELECT COUNT(*) AS total
    FROM CheckIn
    WHERE checkinDateKey = ${dateKey}
  `
  const moodExplain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    EXPLAIN SELECT mood, COUNT(*) AS total
    FROM CheckIn
    WHERE checkinDateKey = ${dateKey} AND mood IS NOT NULL
    GROUP BY mood
  `
  const indexes = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SHOW INDEX FROM CheckIn
  `
  const count = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) AS total FROM CheckIn WHERE checkinDateKey = ${dateKey}
  `
  const rateLimitLookupExplain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    EXPLAIN SELECT id, count, expiresAt
    FROM RateLimitLog
    WHERE id = 'diagnostic-sample-bucket'
  `
  const rateLimitPruneExplain = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    EXPLAIN SELECT id
    FROM RateLimitLog
    WHERE expiresAt < NOW()
    LIMIT 1000
  `
  console.log(JSON.stringify({ event: 'checkin.explain', label, dateKey, count, countExplain, moodExplain, indexes, rateLimitLookupExplain, rateLimitPruneExplain }, null, 2))
}

main().finally(() => prisma.$disconnect())
