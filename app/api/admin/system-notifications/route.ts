import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { broadcastRealtimeChange } from '@/lib/realtime'
import { requireAdmin, sanitizeText } from '@/lib/security'
import {
  parseSystemNotificationType,
  serializeSystemNotification,
  systemNotificationSelect,
  systemNotificationTypes,
  validateActionUrl,
} from '@/lib/system-notifications'

function parseOptionalDate(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status })
}

export async function GET(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const status = searchParams.get('status')
  const q = sanitizeText(searchParams.get('q'), 80)

  const [totalUsers, notifications] = await Promise.all([
    prisma.user.count({ where: { status: 'ACTIVE', isDeleted: false } }),
    prisma.systemNotification.findMany({
      where: {
        ...(type && systemNotificationTypes.includes(type as never) ? { type: type as never } : {}),
        ...(status === 'published' ? { published: true } : status === 'draft' ? { published: false } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { content: { contains: q } },
                { version: { contains: q } },
              ],
            }
          : {}),
      },
      orderBy: [{ sticky: 'desc' }, { priority: 'desc' }, { publishAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      select: systemNotificationSelect,
    }),
  ])

  return NextResponse.json({
    notifications: notifications.map((item) => serializeSystemNotification(item, totalUsers)),
    totalUsers,
    typeOptions: systemNotificationTypes,
  })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const title = sanitizeText(body?.title, 100)
  const content = sanitizeText(body?.content, 8000)
  const type = parseSystemNotificationType(body?.type)
  const link = validateActionUrl(sanitizeText(body?.link, 500))
  const buttonUrl = validateActionUrl(sanitizeText(body?.buttonUrl, 500))
  const buttonText = sanitizeText(body?.buttonText, 40) || null
  const cover = validateActionUrl(sanitizeText(body?.cover, 500))
  const version = sanitizeText(body?.version, 40) || null
  const priority = Math.max(0, Math.min(Number(body?.priority || 0), 100))
  const published = Boolean(body?.published ?? body?.publishNow ?? true)
  const publishAt = parseOptionalDate(body?.publishAt) || new Date()
  const expireAt = parseOptionalDate(body?.expireAt)

  if (!title) return jsonError('请填写通知标题')
  if (!content || content.length < 2) return jsonError('请填写通知内容')
  if (type === 'UPDATE' && !version) return jsonError('更新日志必须填写版本号')
  if (expireAt && expireAt <= publishAt) return jsonError('失效时间必须晚于发布时间')
  if (body?.link && !link) return jsonError('跳转链接只能使用站内路径或 http/https 地址')
  if (body?.buttonUrl && !buttonUrl) return jsonError('按钮链接只能使用站内路径或 http/https 地址')

  const notification = await prisma.systemNotification.create({
    data: {
      title,
      content,
      link,
      type,
      cover,
      priority,
      popup: Boolean(body?.popup),
      sticky: Boolean(body?.sticky),
      publishAt,
      expireAt,
      published,
      buttonText,
      buttonUrl,
      version,
      isPublished: published,
      publishedAt: publishAt,
      createdById: guard.user.id,
    },
    select: systemNotificationSelect,
  })
  if (published && type !== 'UPDATE') broadcastRealtimeChange('notification')

  return NextResponse.json({ notification: serializeSystemNotification(notification), message: published ? '通知已发布' : '通知草稿已保存' }, { status: 201 })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return jsonError('通知不存在')

  const current = await prisma.systemNotification.findUnique({ where: { id }, select: { id: true, publishAt: true } })
  if (!current) return jsonError('通知不存在', 404)

  const data: Parameters<typeof prisma.systemNotification.update>[0]['data'] = {}

  if (body?.title !== undefined) {
    const title = sanitizeText(body.title, 100)
    if (!title) return jsonError('请填写通知标题')
    data.title = title
  }
  if (body?.content !== undefined) {
    const content = sanitizeText(body.content, 8000)
    if (!content || content.length < 2) return jsonError('请填写通知内容')
    data.content = content
  }
  if (body?.type !== undefined) data.type = parseSystemNotificationType(body.type)
  if (body?.link !== undefined) {
    const link = validateActionUrl(sanitizeText(body.link, 500))
    if (body.link && !link) return jsonError('跳转链接只能使用站内路径或 http/https 地址')
    data.link = link
  }
  if (body?.buttonUrl !== undefined) {
    const buttonUrl = validateActionUrl(sanitizeText(body.buttonUrl, 500))
    if (body.buttonUrl && !buttonUrl) return jsonError('按钮链接只能使用站内路径或 http/https 地址')
    data.buttonUrl = buttonUrl
  }
  if (body?.cover !== undefined) data.cover = validateActionUrl(sanitizeText(body.cover, 500))
  if (body?.buttonText !== undefined) data.buttonText = sanitizeText(body.buttonText, 40) || null
  if (body?.priority !== undefined) data.priority = Math.max(0, Math.min(Number(body.priority || 0), 100))
  if (body?.popup !== undefined) data.popup = Boolean(body.popup)
  if (body?.sticky !== undefined) data.sticky = Boolean(body.sticky)
  if (body?.published !== undefined || body?.isPublished !== undefined) {
    const published = Boolean(body?.published ?? body?.isPublished)
    data.published = published
    data.isPublished = published
  }
  if (body?.publishAt !== undefined) {
    const publishAt = parseOptionalDate(body.publishAt)
    if (!publishAt) return jsonError('请选择有效发布时间')
    data.publishAt = publishAt
    data.publishedAt = publishAt
  }
  if (body?.expireAt !== undefined) data.expireAt = parseOptionalDate(body.expireAt)
  if (body?.version !== undefined) data.version = sanitizeText(body.version, 40) || null

  const nextType = (data.type || body?.type || undefined) ? parseSystemNotificationType(data.type || body?.type) : undefined
  const nextVersion = data.version !== undefined ? data.version : undefined
  if (nextType === 'UPDATE' && nextVersion === null) return jsonError('更新日志必须填写版本号')

  const notification = await prisma.systemNotification.update({
    where: { id },
    data,
    select: systemNotificationSelect,
  })

  if (notification.type === 'UPDATE' && !notification.version) {
    return jsonError('更新日志必须填写版本号')
  }
  if (notification.type !== 'UPDATE') broadcastRealtimeChange('notification')

  return NextResponse.json({ notification: serializeSystemNotification(notification), message: '通知已保存' })
}

export async function DELETE(request: Request) {
  const guard = await requireAdmin('notification_manage')
  if (!guard.user) return guard.response

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id') || ''
  if (!id) return jsonError('通知不存在')

  await prisma.systemNotification.delete({ where: { id } })
  broadcastRealtimeChange('notification')
  return NextResponse.json({ ok: true, message: '通知已删除' })
}
