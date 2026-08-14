import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { adminAuditOperationLabels, type AdminAuditOperation } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const actionLabels: Record<string, string> = {
  APPROVE_POST: '审核通过帖子',
  REJECT_POST: '审核拒绝帖子',
  EDIT_POST: '管理员编辑帖子',
  FEATURE_POST: '设置精华',
  UNFEATURE_POST: '取消精华',
  PIN_POST: '置顶帖子',
  UNPIN_POST: '取消置顶',
  DELETE_POST: '删除帖子',
  RESTORE_POST: '恢复帖子',
}

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function operationLabel(operationType: string | null, action: string) {
  return operationType && operationType in adminAuditOperationLabels
    ? adminAuditOperationLabels[operationType as AdminAuditOperation]
    : actionLabels[action] || action
}

export async function GET(request: Request) {
  const guard = await requireAdmin('post_manage')
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(10, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const operationType = sanitizeText(params.get('operationType'), 80)
  const targetType = sanitizeText(params.get('targetType'), 40).toUpperCase()
  const adminQuery = sanitizeText(params.get('admin'), 120)
  const query = sanitizeText(params.get('q'), 160)
  const from = parseDate(params.get('from'))
  const to = parseDate(params.get('to'), true)

  const and: Prisma.AdminActionWhereInput[] = []
  if (operationType) and.push({ operationType })
  if (targetType) and.push({ targetType })
  if (from || to) and.push({ createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } })
  if (adminQuery) {
    const uid = Number(adminQuery)
    and.push({
      OR: [
        { operatorName: { contains: adminQuery } },
        { operatorUsername: { contains: adminQuery } },
        ...(Number.isInteger(uid) ? [{ operatorUid: uid }] : []),
        { adminId: adminQuery },
      ],
    })
  }
  if (query) {
    const uid = Number(query)
    and.push({
      OR: [
        { targetTitle: { contains: query } },
        { targetId: { contains: query } },
        { postId: { contains: query } },
        { targetUserName: { contains: query } },
        ...(Number.isInteger(uid) ? [{ targetUserUid: uid }, { operatorUid: uid }] : []),
      ],
    })
  }
  const where: Prisma.AdminActionWhereInput = and.length ? { AND: and } : {}

  const [total, rows] = await prisma.$transaction([
    prisma.adminAction.count({ where }),
    prisma.adminAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        adminId: true,
        operatorName: true,
        operatorUsername: true,
        operatorUid: true,
        operationType: true,
        targetType: true,
        targetId: true,
        targetTitle: true,
        targetUserId: true,
        targetUserName: true,
        targetUserUid: true,
        result: true,
        postId: true,
        User_AdminAction_adminIdToUser: {
          select: { uid: true, username: true, nickname: true, Profile: { select: { displayName: true } } },
        },
        Post: { select: { title: true } },
      },
    }),
  ])

  return NextResponse.json({
    logs: rows.map((row) => {
      const operator = row.User_AdminAction_adminIdToUser
      const targetTitle = row.targetTitle || row.Post?.title || null
      return {
        id: row.id,
        operationType: row.operationType,
        operationLabel: operationLabel(row.operationType, row.action),
        action: row.action,
        result: row.result || 'SUCCESS',
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        operatorId: row.adminId,
        operatorName: row.operatorName || operator?.Profile?.displayName || operator?.nickname || '原管理员账号已不存在',
        operatorUsername: row.operatorUsername || operator?.username || null,
        operatorUid: row.operatorUid ?? operator?.uid ?? null,
        targetType: row.targetType || (row.postId ? 'POST' : 'UNKNOWN'),
        targetId: row.targetId || row.postId || null,
        targetTitle,
        targetUserId: row.targetUserId,
        targetUserName: row.targetUserName,
        targetUserUid: row.targetUserUid,
      }
    }),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

