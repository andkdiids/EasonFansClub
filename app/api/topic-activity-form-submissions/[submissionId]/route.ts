import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { resolveRequestAuth } from '@/lib/security'
import { serializeTopicActivityFormSubmission } from '@/lib/topic-activity-form-view'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
const relations = {
  User: { select: { id: true, nickname: true, avatarUrl: true } },
  ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } },
  Replies: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }], include: { Sender: { select: { id: true, nickname: true } }, ImageAssets: { select: { id: true, storageKey: true, mimeType: true, width: true, height: true, size: true } } } },
}

export async function GET(request: Request, context: { params: Promise<{ submissionId: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  if (!auth.user) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  const { submissionId } = await context.params
  const submission = await prisma.topicActivityFormSubmission.findUnique({ where: { id: submissionId }, include: relations })
  if (!submission) return NextResponse.json({ message: '表单提交不存在' }, { status: 404 })
  const isOwner = submission.userId === auth.user.id
  const isAdmin = await hasAdminPermission(auth.user, 'activity_manage')
  if (!isOwner && !isAdmin) return NextResponse.json({ message: '无权查看此表单' }, { status: 404 })
  return NextResponse.json({ submission: await serializeTopicActivityFormSubmission(submission) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
}
