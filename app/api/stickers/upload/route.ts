import { NextResponse } from 'next/server'
import {
  STICKER_MAX_FILE_SIZE,
  uploadStickerImage,
  uploadStickerPackCover,
} from '@/lib/sticker-upload'
import { requireUser } from '@/lib/security'
import { SiteMediaStorageError } from '@/lib/site-media-storage'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 表情包上传基础接口（供未来「创建表情包」流程复用）：
 * - 必须登录。
 * - 必须随文件提交 type=STATIC|GIF；静态仅接受 JPG/PNG/WebP，GIF 仅接受 image/gif。
 * - kind=cover 时上传合集封面（始终静态 webp）。
 */
export async function POST(request: Request) {
  try {
    const guard = await requireUser()
    if (!guard.user) return guard.response

    const formData = await request.formData().catch((error) => {
      console.error('[sticker.upload.form-data]', error)
      return null
    })
    if (!formData) {
      return NextResponse.json(
        { success: false, message: '上传请求无效或文件超过服务器限制' },
        { status: 400 },
      )
    }

    const file = formData.get('file')
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: '请选择表情图片' }, { status: 400 })

    const kind = formData.get('kind')
    const typeRaw = String(formData.get('type') || 'STATIC').toUpperCase()
    const type = typeRaw === 'GIF' ? 'GIF' : 'STATIC'

    if (file.size === 0) return NextResponse.json({ success: false, message: '表情文件不能为空' }, { status: 400 })
    if (file.size > STICKER_MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, message: '表情文件不能超过 5MB' }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      if (kind === 'cover') {
        const url = await uploadStickerPackCover({ ownerId: guard.user.id, buffer })
        return NextResponse.json({ success: true, url, format: 'webp' })
      }
      const result = await uploadStickerImage({ ownerId: guard.user.id, type, buffer })
      return NextResponse.json({
        success: true,
        url: result.url,
        format: result.format,
        type: result.type,
        isAnimated: result.isAnimated,
      })
    } catch (error) {
      const message =
        error instanceof SiteMediaStorageError
          ? error.message
          : error instanceof Error
            ? error.message
            : '上传失败，请稍后重试'
      return NextResponse.json({ success: false, message }, { status: 502 })
    }
  } catch (error) {
    console.error('[sticker-upload.unhandled]', error)
    return NextResponse.json({ success: false, message: '上传失败，请查看服务器日志后重试' }, { status: 500 })
  }
}
