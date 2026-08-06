import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin, sanitizeText } from '@/lib/security'
import {
  setStickerEnabled,
  setStickerHidden,
  deleteStickerAsAdmin,
  dismissStickerReport,
  getStickerReports,
} from '@/lib/sticker-center'

export const dynamic = 'force-dynamic'

/** 后台：获取单个表情的举报列表。 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response
  const { id } = await params
  if (!id) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })
  const reports = await getStickerReports(id)
  return NextResponse.json({ reports })
}

type StickerAction =
  | 'enable'
  | 'disable'
  | 'hide'
  | 'restore'
  | 'delete'
  | 'dismissReport'

/**
 * 后台对单个表情的操作：
 * - enable/disable：官方表情上架/下架。
 * - hide/restore：违规隐藏与恢复（hide 时可附 reason）。
 * - delete：删除表情（含级联记录）。
 * - dismissReport：忽略某条举报，需 reportId。
 * 操作后可附带 ?reports=1 返回该表情的最新举报列表。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response

  const { id } = await params
  if (!id) return NextResponse.json({ message: '缺少表情标识' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const action = body.action as StickerAction
  if (!['enable', 'disable', 'hide', 'restore', 'delete', 'dismissReport'].includes(action)) {
    return NextResponse.json({ message: '操作无效' }, { status: 400 })
  }

  try {
    if (action === 'enable') {
      await setStickerEnabled(id, true)
    } else if (action === 'disable') {
      await setStickerEnabled(id, false)
    } else if (action === 'hide') {
      const reason = body.reason ? sanitizeText(body.reason, 200) : undefined
      await setStickerHidden(id, true, reason)
    } else if (action === 'restore') {
      await setStickerHidden(id, false)
    } else if (action === 'delete') {
      await deleteStickerAsAdmin(id)
    } else if (action === 'dismissReport') {
      const reportId = String(body.reportId || '')
      if (!reportId) return NextResponse.json({ message: '缺少举报标识' }, { status: 400 })
      await dismissStickerReport(reportId)
    }

    revalidatePath('/admin/stickers')
    const includeReports = body.reports === true || body.reports === 'true'
    if (action === 'dismissReport' && includeReports) {
      const reports = await getStickerReports(id)
      return NextResponse.json({ success: true, reports })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[admin.sticker.action]', { id, action, error })
    return NextResponse.json({ message: '操作失败，请稍后重试' }, { status: 500 })
  }
}
