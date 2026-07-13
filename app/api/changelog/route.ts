import { NextResponse } from 'next/server'
import { changelogSelect, serializeChangelog } from '@/lib/changelog'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const logs = await prisma.changelog.findMany({
    where: {
      status: 'PUBLISHED',
      publishedAt: { lte: new Date() },
    },
    orderBy: [{ major: 'desc' }, { minor: 'desc' }, { patch: 'desc' }],
    take: 50,
    select: changelogSelect,
  })

  return NextResponse.json({ changelogs: logs.map(serializeChangelog) })
}
