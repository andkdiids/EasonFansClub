import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function groupDuplicates(field) {
  const rows = await prisma.user.groupBy({
    by: [field],
    where: { [field]: { not: null }, isDeleted: false },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })
  return rows
}

async function main() {
  const [duplicatePhones, duplicateEmails, missingProfiles, duplicateProfiles, orphanProfiles] = await Promise.all([
    groupDuplicates('phone'),
    groupDuplicates('email'),
    prisma.user.findMany({
      where: { isDeleted: false, profile: null },
      select: { id: true, uid: true, nickname: true, phone: true, email: true, status: true },
    }),
    prisma.profile.groupBy({
      by: ['userId'],
      _count: { id: true },
      having: { id: { _count: { gt: 1 } } },
    }),
    prisma.$queryRaw`
      SELECT p.id, p."userId", p."displayName"
      FROM "Profile" p
      LEFT JOIN "User" u ON u.id = p."userId"
      WHERE u.id IS NULL
    `.catch(() => []),
  ])

  console.log(JSON.stringify({
    duplicatePhones,
    duplicateEmails,
    missingProfiles,
    duplicateProfiles,
    orphanProfiles,
  }, null, 2))
}

main()
  .finally(async () => {
    await prisma.$disconnect()
  })
