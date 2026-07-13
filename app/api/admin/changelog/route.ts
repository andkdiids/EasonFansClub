import { NextResponse } from 'next/server'
import { changelogSelect, changelogStatuses, changelogTypes, mapChangelogTypeToPriority, nextVersion, parseChangelogType, parseVersionBump, serializeChangelog } from '@/lib/changelog'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('changelog_manage')
  if (!guard.user) return guard.response

  const logs = await prisma.systemNotification.findMany({
    where: { type: 'UPDATE' },
    orderBy: [{ publishAt: 'desc' }, { createdAt: 'desc' }],
    take: 100,
    select: changelogSelect,
  })

  return NextResponse.json({
    changelogs: logs.map(serializeChangelog),
    typeOptions: changelogTypes,
    statusOptions: changelogStatuses,
  })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('changelog_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const title = sanitizeText(body?.title, 100)
  const content = sanitizeText(body?.content, 6000)
  const changelogType = parseChangelogType(body?.type)
  const isMajor = Boolean(body?.isMajor)
  const publishNow = Boolean(body?.publishNow)
  const bump = parseVersionBump(body?.bump)

  if (!title) return NextResponse.json({ message: '请填写更新标题' }, { status: 400 })
  if (!content || content.length < 5) return NextResponse.json({ message: '请填写更新内容' }, { status: 400 })

  try {
    const log = await prisma.$transaction(async (tx) => {
      const latestRows = await tx.systemNotification.findMany({
        where: { type: 'UPDATE', version: { not: null } },
        select: { version: true },
        take: 100,
      })
      const latest = latestRows
        .map((item) => ({ version: item.version }))
        .sort((a, b) => {
          const av = a.version || ''
          const bv = b.version || ''
          return bv.localeCompare(av, undefined, { numeric: true })
        })[0] || null
      const version = nextVersion(latest, bump)

      return tx.systemNotification.create({
        data: {
          title,
          content,
          type: 'UPDATE',
          version: version.version,
          priority: mapChangelogTypeToPriority(changelogType, isMajor),
          sticky: isMajor,
          popup: false,
          published: publishNow,
          isPublished: publishNow,
          publishAt: new Date(),
          publishedAt: new Date(),
          createdById: guard.user.id,
        },
        select: changelogSelect,
      })
    })

    return NextResponse.json({ changelog: serializeChangelog(log), message: publishNow ? '更新日志已发布' : '更新日志草稿已创建' }, { status: 201 })
  } catch (error) {
    console.error('[admin.changelog.create]', error)
    return NextResponse.json({ message: '版本号生成冲突，请稍后重试' }, { status: 409 })
  }
}
