import { loadEnvFile } from 'node:process'

async function main() {
  if (!process.env.DATABASE_URL) loadEnvFile('.env')
  const [{ scanAllContentForModeration }, { prisma }] = await Promise.all([
    import('../lib/content-moderation-scan'),
    import('../lib/prisma'),
  ])
  const summary = await scanAllContentForModeration()
  console.info(JSON.stringify(summary, null, 2))
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error('[moderation:scan] failed', error)
  process.exitCode = 1
})
