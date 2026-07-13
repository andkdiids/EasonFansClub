import { NextResponse } from 'next/server'
import { changelogSelect, serializeChangelog } from '@/lib/changelog'
import { prisma } from '@/lib/prisma'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'

export const dynamic = 'force-dynamic'

export async function GET() {
  const logs = await prisma.systemNotification.findMany({
    where: {
      ...effectiveSystemNotificationWhere(new Date()),
      type: 'UPDATE',
      version: { not: null },
    },
    orderBy: effectiveSystemNotificationOrder,
    take: 50,
    select: changelogSelect,
  })

  return NextResponse.json({ changelogs: logs.map(serializeChangelog) })
}
