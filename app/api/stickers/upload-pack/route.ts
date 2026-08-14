import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { readFile } from 'node:fs/promises'
import { requireUser } from '@/lib/security'
import {
  uploadStickerImage,
  uploadStickerPackCover,
  STICKER_MAX_FILE_SIZE,
  STICKER_MAX_PACK_NAME_LENGTH,
  STICKER_MAX_DESCRIPTION_LENGTH,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  getStickerUploadErrorResponse,
} from '@/lib/sticker-upload'
import { submitStickerPack } from '@/lib/sticker-center'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import {
  parseStickerPackMultipart,
  removeStickerMultipartTempDirectory,
  StickerMultipartError,
} from '@/lib/sticker-pack-multipart'

export const runtime = 'nodejs'
export const maxDuration = 180

const STICKER_PACK_TOO_LARGE_MESSAGE = '文件总大小超过限制'

function isPayloadTooLargeError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown }
  const status = Number(candidate.status ?? candidate.statusCode)
  if (status === 413) return true

  const detail = [candidate.code, candidate.message].filter(Boolean).map(String).join(' ').toLowerCase()
  return /413|payload too large|request entity too large|body exceeded|body.*(?:size|limit|exceed)|(?:request|content).*(?:large|limit|exceed)/.test(detail)
}

function describeUploadPackError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    }
  }
  return error
}

/**
 * 用户上传表情包：multipart/form-data
 * - `name`: 合集名称（≤ 40 字）
 * - `description`: 合集简介（≤ 200 字，可选）
 * - `copyright`: 版权信息（≤ 100 字，可选）
 * - `category`: 分类（可选）
 * - `type`: STATIC|GIF
 * - `cover`: 静态封面图（必选）
 * - `stickerFiles`: 多张表情图片（至少 6 张，至多 60 张）
 * - `stickerNames`: 与 stickerFiles 顺序一一对应的名称数组（可选）
 *
 * 提交后进入 PENDING 审核流程。
 */
export async function POST(request: Request) {
  let stage = 'request_received'
  let stickerIndex: number | null = null
  console.info('[sticker.uploadPack]', {
    stage,
    method: request.method,
    contentType: request.headers.get('content-type'),
    contentLength: request.headers.get('content-length'),
  })

  stage = 'authentication'
  const guard = await requireUser()
  if (!guard.user) {
    console.warn('[sticker.uploadPack]', { stage, status: guard.response.status })
    return guard.response
  }

  let tempDirectory: string | null = null
  try {
    stage = 'multipart_parsing'
    const parsed = await parseStickerPackMultipart(request)
    tempDirectory = parsed.tempDirectory

    const firstField = (fieldName: string) => parsed.fields.get(fieldName)?.[0] || ''
    const name = firstField('name').trim()
    if (!name) return NextResponse.json({ success: false, message: '请填写表情包名称' }, { status: 400 })
    if (name.length > STICKER_MAX_PACK_NAME_LENGTH) {
      return NextResponse.json({ success: false, message: `名称不能超过 ${STICKER_MAX_PACK_NAME_LENGTH} 字` }, { status: 400 })
    }

    const description = firstField('description').slice(0, STICKER_MAX_DESCRIPTION_LENGTH).trim()
    const copyright = firstField('copyright').slice(0, 100).trim()
    const category = firstField('category').slice(0, 40).trim()
    const typeRaw = (firstField('type') || 'STATIC').toUpperCase()
    const type = typeRaw === 'GIF' ? 'GIF' : 'STATIC'
    if ((await checkBannedWords(`${name}\n${description}`)).blocked) {
      return NextResponse.json({ success: false, error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
    }

    const stickerFiles = parsed.files
      .filter((file) => file.fieldName === 'stickerFiles')
      .sort((left, right) => left.ordinal - right.ordinal)
    const stickerNamesRaw = parsed.fields.get('stickerNames') || []
    if ((await checkBannedWords(stickerNamesRaw.join('\n'))).blocked) {
      return NextResponse.json({ success: false, error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
    }
    const coverFile = parsed.files.find((file) => file.fieldName === 'cover') || null
    if (!coverFile || coverFile.size === 0) {
      return NextResponse.json({ success: false, code: 'COVER_REQUIRED', message: '请选择表情包封面' }, { status: 400 })
    }
    const coverSize = coverFile && coverFile.size > 0 ? coverFile.size : 0
    const stickerTotalSize = stickerFiles.reduce((total, file) => total + file.size, 0)
    stage = 'form_data_parsed'
    console.info('[sticker.uploadPack]', {
      stage,
      fileCount: stickerFiles.length,
      files: stickerFiles.map((file) => ({ name: file.filename, size: file.size, type: file.mimeType })),
      stickerTotalSize,
      coverSize,
      totalFileSize: stickerTotalSize + coverSize,
      contentLength: request.headers.get('content-length'),
    })

    stage = 'parameter_validation'
    if (stickerFiles.length < 6) {
      return NextResponse.json({ success: false, message: '至少需要 6 张表情' }, { status: 400 })
    }
    if (stickerFiles.length > 60) {
      return NextResponse.json({ success: false, message: '最多 60 张表情' }, { status: 400 })
    }
    for (const file of stickerFiles) {
      if (file.size === 0) return NextResponse.json({ success: false, message: '请选择有效的表情文件' }, { status: 400 })
      if (file.size > STICKER_MAX_FILE_SIZE) {
        return NextResponse.json({ success: false, code: 'FILE_TOO_LARGE', message: STICKER_FILE_TOO_LARGE_MESSAGE }, { status: 413 })
      }
    }

    let coverUrl: string | null = null
    console.info('[sticker.uploadPack]', {
      stage: 'file_processing_started',
      fileCount: stickerFiles.length,
      totalFileSize: stickerTotalSize + coverSize,
    })

    stage = 'cover_upload'
    if (coverFile && coverFile.size > 0) {
      const buf = await readFile(coverFile.path)
      coverUrl = await uploadStickerPackCover({ ownerId: guard.user.id, buffer: buf })
      console.info('[sticker.uploadPack]', {
        stage: 'cos_upload_success',
        kind: 'cover',
        url: coverUrl,
        size: buf.byteLength,
      })
    }

    const uploadedStickers: Array<{ name: string | null; url: string; type: 'STATIC' | 'GIF' }> = []
    stage = 'sticker_upload'
    for (let i = 0; i < stickerFiles.length; i += 1) {
      stickerIndex = i
      const file = stickerFiles[i]
      const buf = await readFile(file.path)
      console.info('[sticker.uploadPack]', {
        stage: 'sticker_processing_started',
        index: i,
        name: file.filename,
        size: file.size,
        type: file.mimeType,
      })
      const result = await uploadStickerImage({
        ownerId: guard.user.id,
        type,
        buffer: buf,
      })
      const rawName = stickerNamesRaw[i] || ''
      const trimmed = rawName.trim().slice(0, 4)
      uploadedStickers.push({ name: trimmed || null, url: result.url, type: result.type })
      console.info('[sticker.uploadPack]', {
        stage: 'cos_upload_success',
        kind: 'sticker',
        index: i,
        url: result.url,
        size: buf.byteLength,
        outputFormat: result.format,
        isAnimated: result.isAnimated,
      })
    }

    const packType = uploadedStickers.some((sticker) => sticker.type === 'GIF') ? 'GIF' : 'STATIC'

    stage = 'prisma_create_started'
    console.info('[sticker.uploadPack]', {
      stage,
      fileCount: uploadedStickers.length,
      packType,
      hasCover: Boolean(coverUrl),
    })
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
    stage = 'prisma_create_succeeded'
    console.info('[sticker.uploadPack]', { stage, packId })

    revalidatePath('/profile/stickers')
    return NextResponse.json({
      success: true,
      packId,
      status: 'PENDING',
      message: '已提交审核，请等待管理员审核',
    })
  } catch (error) {
    const multipartFailure = error instanceof StickerMultipartError
      ? {
          status: error.code === 'FILE_TOO_LARGE' ? 413 : 400,
          code: error.code,
          message: error.message,
        }
      : null
    const tooLarge = isPayloadTooLargeError(error)
    const failure = getStickerUploadErrorResponse(error)
    const status = tooLarge || multipartFailure?.status === 413
      ? 413
      : multipartFailure
        ? 400
        : failure.status === 400
          ? 400
          : 500
    console.error('[sticker.uploadPack]', {
      stage,
      stickerIndex,
      error: describeUploadPackError(error),
      fullError: error,
    })
    return NextResponse.json(
      {
        success: false,
        code: tooLarge || multipartFailure?.status === 413
          ? 'REQUEST_TOO_LARGE'
          : multipartFailure
            ? 'INVALID_REQUEST'
            : failure.status === 400
              ? failure.code
              : 'SERVER_ERROR',
        message: tooLarge || multipartFailure?.status === 413
          ? multipartFailure?.code === 'FILE_TOO_LARGE'
            ? STICKER_FILE_TOO_LARGE_MESSAGE
            : STICKER_PACK_TOO_LARGE_MESSAGE
          : multipartFailure
            ? multipartFailure.message
            : failure.status === 400
              ? failure.message
              : '服务器错误',
      },
      { status },
    )
  } finally {
    if (tempDirectory) {
      try {
        await removeStickerMultipartTempDirectory(tempDirectory)
      } catch (cleanupError) {
        console.warn('[sticker.uploadPack]', {
          stage: 'multipart_temp_cleanup',
          tempDirectory,
          error: describeUploadPackError(cleanupError),
        })
      }
    }
  }
}
