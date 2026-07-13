import { NextResponse } from 'next/server'
import { changelogSelect, mapChangelogTypeToPriority, parseChangelogStatus, parseChangelogType, serializeChangelog } from '@/lib/changelog'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('changelog_manage')
  if (!guard.user) return guard.response

  const { id } = await params
  const body = await request.json().catch(() => null)
  const status = body?.status === undefined ? undefined : parseChangelogStatus(body.status)
  const title = body?.title === undefined ? undefined : sanitizeText(body.title, 100)
  const content = body?.content === undefined ? undefined : sanitizeText(body.content, 6000)
  const changelogType = body?.type === undefined ? undefined : parseChangelogType(body.type)
  const isMajor = body?.isMajor === undefined ? undefined : Boolean(body.isMajor)

  if (body?.status !== undefined && !status) return NextResponse.json({ message: '请选择有效的发布状态' }, { status: 400 })
  if (title !== undefined && !title) return NextResponse.json({ message: '请填写更新标题' }, { status: 400 })
  if (content !== undefined && content.length < 5) return NextResponse.json({ message: '请填写更新内容' }, { status: 400 })

  const current = await prisma.systemNotification.findFirst({ where: { id, type: 'UPDATE' }, select: { id: true, published: true, priority: true } })
  if (!current) return NextResponse.json({ message: '更新日志不存在' }, { status: 404 })

  const published = status ? status === 'PUBLISHED' : undefined
  const log = await prisma.systemNotification.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(changelogType !== undefined || isMajor !== undefined
        ? { priority: mapChangelogTypeToPriority(changelogType || 'IMPROVEMENT', isMajor ?? current.priority >= 80) }
        : {}),
      ...(published !== undefined
        ? {
            published,
            isPublished: published,
            ...(published ? { publishAt: new Date(), publishedAt: new Date() } : {}),
          }
        : {}),
    },
    select: changelogSelect,
  })

  return NextResponse.json({ changelog: serializeChangelog(log), message: '更新日志已保存' })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin('changelog_manage')
  if (!guard.user) return guard.response

  const { id } = await params
  const current = await prisma.systemNotification.findFirst({ where: { id, type: 'UPDATE' }, select: { published: true } })
  if (!current) return NextResponse.json({ message: '更新日志不存在' }, { status: 404 })
  if (current.published) {
    return NextResponse.json({ message: '只能删除草稿，已发布的更新日志请下架保留历史记录' }, { status: 400 })
  }

  await prisma.systemNotification.delete({ where: { id } })
  return NextResponse.json({ ok: true, message: '草稿已删除' })
}
