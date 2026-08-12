import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { convertMusicCoverToWebp, MUSIC_COVER_MAX_FILE_SIZE } from '@/lib/music-cover'
import { isSupportedMusicCoverFile } from '@/lib/music-upload-constraints'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { publicImageUrl } from '@/lib/images'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * 徽章图标上传：复用现有图片处理与 COS 上传逻辑，自动转换为 WebP。
 * 仅管理员可调用（music_manage）。返回公开可访问的 iconUrl。
 */
export async function POST(request: Request) {
  try {
    const guard = await requireAdmin('music_manage')
    if (!guard.user) return guard.response

    const formData = await request.formData().catch(() => null)
    if (!formData) return NextResponse.json({ success: false, message: '上传请求无效' }, { status: 400 })

    const file = formData.get('file')
    if (!(file instanceof File)) return NextResponse.json({ success: false, message: '请选择图标图片' }, { status: 400 })
    if (!isSupportedMusicCoverFile(file)) return NextResponse.json({ success: false, message: '仅支持 JPG、JPEG、PNG、WebP' }, { status: 400 })
    if (file.size === 0) return NextResponse.json({ success: false, message: '图片文件不能为空' }, { status: 400 })
    if (file.size > MUSIC_COVER_MAX_FILE_SIZE) return NextResponse.json({ success: false, message: '图标图片不能超过 10MB' }, { status: 413 })

    let output: Buffer
    try {
      output = await convertMusicCoverToWebp(Buffer.from(await file.arrayBuffer()))
    } catch (error) {
      const detail = error instanceof Error ? error.message.trim().slice(0, 200) : '图片转换失败'
      return NextResponse.json({ success: false, message: `图片转换失败：${detail}` }, { status: 400 })
    }

    const objectPath = `badges/${guard.user.id}/${randomUUID()}.webp`
    try {
      const url = publicImageUrl(await uploadSiteImage({ key: objectPath, body: output }))
      return NextResponse.json({ success: true, url, format: 'webp' })
    } catch (error) {
      return NextResponse.json(
        { success: false, message: error instanceof SiteMediaStorageError ? error.message : '图标上传失败，请稍后重试' },
        { status: 502 },
      )
    }
  } catch (error) {
    console.error('[badge-icon.unhandled]', error)
    return NextResponse.json({ success: false, message: '图标上传失败，请查看服务器日志后重试' }, { status: 500 })
  }
}
