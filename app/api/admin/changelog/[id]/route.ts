import { NextResponse } from 'next/server'
import { changelogSelect, parseChangelogStatus, parseChangelogType, serializeChangelog } from '@/lib/changelog'
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
  const type = body?.type === undefined ? undefined : parseChangelogType(body.type)

  if (body?.status !== undefined && !status) return NextResponse.json({ message: '请选择有效的发布状态' }, { status: 400 })
  if (title !== undefined && !title) return NextResponse.json({ message: '请填写更新标题' }, { status: 400 })
  if (content !== undefined && content.length < 5) return NextResponse.json({ message: '请填写更新内容' }, { status: 400 })

  const current = await prisma.changelog.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!current) return NextResponse.json({ message: '更新日志不存在' }, { status: 404 })

  const log = await prisma.changelog.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(body?.isMajor !== undefined ? { isMajor: Boolean(body.isMajor) } : {}),
      ...(status
        ? {
            status,
            ...(status === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
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
  const current = await prisma.changelog.findUnique({ where: { id }, select: { status: true } })
  if (!current) return NextResponse.json({ message: '更新日志不存在' }, { status: 404 })
  if (current.status !== 'DRAFT') {
    return NextResponse.json({ message: '只能删除草稿，已发布或已下架的更新日志请保留历史记录' }, { status: 400 })
  }

  await prisma.changelog.delete({ where: { id } })
  return NextResponse.json({ ok: true, message: '草稿已删除' })
}
