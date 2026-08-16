import { NextResponse } from 'next/server'
import {
  STICKER_MAX_FILE_SIZE,
  uploadStickerImage,
  uploadStickerPackCover,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  getStickerFormDataErrorResponse,
  getStickerUploadErrorResponse,
} from '@/lib/sticker-upload'
import { requireUser } from '@/lib/security'
import { toPublicMediaUrl } from '@/lib/media-url'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 表情包上传基础接口（供未来「创建表情包」流程复用）：
 * - 必须登录。
 * - 必须随文件提交 type=STATIC|GIF；服务端按真实文件内容识别静态图或动画图。
 * - kind=cover 时上传合集封面（始终静态 webp）。
 */
export async function POST(request: Request) {
  try {
    const guard = await requireUser()
    if (!guard.user) return guard.response

    let formData: FormData | null = null
    let formDataError: unknown = null
    try {
      formData = await request.formData()
    } catch (error) {
      console.error('[sticker.upload.form-data]', error)
      formDataError = error
    }
    if (!formData) {
      const failure = getStickerFormDataErrorResponse(formDataError)
      return NextResponse.json(
        { success: false, code: failure.code, message: failure.message },
        { status: failure.status },
      )
    }

    const file = formData.get('file')
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: '请选择表情图片' }, { status: 400 })

    const kind = formData.get('kind')
    const typeRaw = String(formData.get('type') || 'STATIC').toUpperCase()
    const type = typeRaw === 'GIF' ? 'GIF' : 'STATIC'

    if (file.size === 0) return NextResponse.json({ success: false, message: '表情文件不能为空' }, { status: 400 })
    if (file.size > STICKER_MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, code: 'FILE_TOO_LARGE', message: STICKER_FILE_TOO_LARGE_MESSAGE }, { status: 413 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    try {
      if (kind === 'cover') {
        const url = await uploadStickerPackCover({
          ownerId: guard.user.id,
          buffer,
          source: { field: 'cover', originalName: file.name, mimeType: file.type },
        })
        return NextResponse.json({
          success: true,
          url: toPublicMediaUrl(url) || url,
          format: 'webp',
        })
      }
      const result = await uploadStickerImage({
        ownerId: guard.user.id,
        type,
        buffer,
        source: { field: 'file', originalName: file.name, mimeType: file.type },
      })
      return NextResponse.json({
        success: true,
        url: toPublicMediaUrl(result.url) || result.url,
        format: result.format,
        type: result.type,
        isAnimated: result.isAnimated,
      })
    } catch (error) {
      const failure = getStickerUploadErrorResponse(error)
      return NextResponse.json({ success: false, code: failure.code, message: failure.message }, { status: failure.status })
    }
  } catch (error) {
    console.error('[sticker-upload.unhandled]', error)
    const failure = getStickerUploadErrorResponse(error)
    return NextResponse.json({ success: false, code: failure.code, message: failure.message }, { status: failure.status })
  }
}
