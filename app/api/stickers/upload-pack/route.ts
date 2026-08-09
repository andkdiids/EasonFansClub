import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/security'
import {
  uploadStickerImage,
  uploadStickerPackCover,
  STICKER_MAX_FILE_SIZE,
  STICKER_MAX_PACK_NAME_LENGTH,
  STICKER_MAX_DESCRIPTION_LENGTH,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  getStickerFormDataErrorResponse,
  getStickerUploadErrorResponse,
} from '@/lib/sticker-upload'
import { submitStickerPack } from '@/lib/sticker-center'

export const runtime = 'nodejs'
export const maxDuration = 180

/**
 * 用户上传表情包：multipart/form-data
 * - `name`: 合集名称（≤ 40 字）
 * - `description`: 合集简介（≤ 200 字，可选）
 * - `copyright`: 版权信息（≤ 100 字，可选）
 * - `category`: 分类（可选）
 * - `type`: STATIC|GIF
 * - `cover`: 封面图（可选）
 * - `stickerFiles`: 多张表情图片（至少 6 张，至多 60 张）
 * - `stickerNames`: 与 stickerFiles 顺序一一对应的名称数组（可选）
 *
 * 提交后进入 PENDING 审核流程。
 */
export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  let formData: FormData | null = null
  let formDataError: unknown = null
  try {
    formData = await request.formData()
  } catch (error) {
    console.error('[sticker.upload-pack.form-data]', error)
    formDataError = error
  }
  if (!formData) {
    const failure = getStickerFormDataErrorResponse(formDataError)
    return NextResponse.json(
      { success: false, code: failure.code, message: failure.message },
      { status: failure.status },
    )
  }

  const name = String(formData.get('name') || '').trim()
  if (!name) return NextResponse.json({ success: false, message: '请填写表情包名称' }, { status: 400 })
  if (name.length > STICKER_MAX_PACK_NAME_LENGTH) {
    return NextResponse.json({ success: false, message: `名称不能超过 ${STICKER_MAX_PACK_NAME_LENGTH} 字` }, { status: 400 })
  }

  const description = String(formData.get('description') || '').slice(0, STICKER_MAX_DESCRIPTION_LENGTH).trim()
  const copyright = String(formData.get('copyright') || '').slice(0, 100).trim()
  const category = String(formData.get('category') || '').slice(0, 40).trim()
  const typeRaw = String(formData.get('type') || 'STATIC').toUpperCase()
  const type = typeRaw === 'GIF' ? 'GIF' : 'STATIC'

  const stickerFiles = formData.getAll('stickerFiles').filter((f): f is File => f instanceof File)
  if (stickerFiles.length < 6) {
    return NextResponse.json({ success: false, message: '至少需要 6 张表情' }, { status: 400 })
  }
  if (stickerFiles.length > 60) {
    return NextResponse.json({ success: false, message: '最多 60 张表情' }, { status: 400 })
  }
  for (const f of stickerFiles) {
    if (f.size === 0) return NextResponse.json({ success: false, message: '请选择有效的表情文件' }, { status: 400 })
    if (f.size > STICKER_MAX_FILE_SIZE) {
      return NextResponse.json({ success: false, code: 'FILE_TOO_LARGE', message: STICKER_FILE_TOO_LARGE_MESSAGE }, { status: 413 })
    }
  }

  const coverFile = formData.get('cover')
  let coverUrl: string | null = null

  try {
    if (coverFile instanceof File && coverFile.size > 0) {
      const buf = Buffer.from(await coverFile.arrayBuffer())
      coverUrl = await uploadStickerPackCover({ ownerId: guard.user.id, buffer: buf })
    }

    const uploadedStickers: Array<{ name: string | null; url: string; type: 'STATIC' | 'GIF' }> = []
    const stickerNamesRaw = formData.getAll('stickerNames').map((n) => String(n || ''))
    for (let i = 0; i < stickerFiles.length; i += 1) {
      const file = stickerFiles[i]
      const buf = Buffer.from(await file.arrayBuffer())
      const result = await uploadStickerImage({
        ownerId: guard.user.id,
        type,
        buffer: buf,
      })
      const rawName = stickerNamesRaw[i] || ''
      const trimmed = rawName.trim().slice(0, 4)
      uploadedStickers.push({ name: trimmed || null, url: result.url, type: result.type })
    }

    const packType = uploadedStickers.some((sticker) => sticker.type === 'GIF') ? 'GIF' : 'STATIC'

    const { packId } = await submitStickerPack({
      creatorId: guard.user.id,
      name,
      description: description || null,
      copyright: copyright || null,
      coverUrl,
      type: packType,
      category: category || null,
      stickers: uploadedStickers,
    })

    revalidatePath('/profile/stickers')
    return NextResponse.json({
      success: true,
      packId,
      status: 'PENDING',
      message: '已提交审核，请等待管理员审核',
    })
  } catch (error) {
    console.error('[sticker.uploadPack]', error)
    const failure = getStickerUploadErrorResponse(error)
    return NextResponse.json(
      {
        success: false,
        code: failure.code,
        message: failure.message,
      },
      { status: failure.status },
    )
  }
}
