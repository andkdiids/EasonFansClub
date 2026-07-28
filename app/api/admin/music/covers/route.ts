import { NextResponse } from 'next/server'
import { supabasePublicObjectUrl } from '@/lib/images'
import { convertMusicCoverToWebp, MUSIC_COVER_MAX_FILE_SIZE, MUSIC_COVER_MAX_WIDTH, MUSIC_COVER_QUALITY, MUSIC_COVER_TYPES } from '@/lib/music-cover'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  const entityType = sanitizeText(formData?.get('entityType'), 20)
  const entityId = sanitizeText(formData?.get('entityId'), 100)
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择封面图片' }, { status: 400 })
  if (!['album', 'song', 'tour', 'concert'].includes(entityType)) return NextResponse.json({ message: '封面目标类型无效' }, { status: 400 })
  if (!entityId) return NextResponse.json({ message: '封面目标不存在' }, { status: 400 })
  if (!MUSIC_COVER_TYPES.has(file.type)) return NextResponse.json({ message: '仅支持 JPG、JPEG、PNG、WEBP' }, { status: 400 })
  if (file.size > MUSIC_COVER_MAX_FILE_SIZE) return NextResponse.json({ message: '封面图片不能超过 10MB' }, { status: 400 })

  const exists = entityType === 'album'
    ? await prisma.musicAlbum.findUnique({ where: { id: entityId }, select: { id: true } })
    : entityType === 'song'
      ? await prisma.musicSong.findUnique({ where: { id: entityId }, select: { id: true } })
      : entityType === 'tour'
        ? await prisma.musicTour.findUnique({ where: { id: entityId }, select: { id: true } })
        : await prisma.musicConcert.findUnique({ where: { id: entityId }, select: { id: true } })
  if (!exists) return NextResponse.json({ message: '封面目标不存在' }, { status: 404 })

  let output: Buffer
  try {
    output = await convertMusicCoverToWebp(Buffer.from(await file.arrayBuffer()))
  } catch {
    return NextResponse.json({ message: '图片处理失败，请确认文件没有损坏' }, { status: 400 })
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_MUSIC_BUCKET || 'music-cover'
  if (!supabaseUrl || !serviceRoleKey) return NextResponse.json({ message: 'Supabase Storage 尚未配置' }, { status: 500 })
  const folder = entityType === 'album' ? 'albums' : entityType === 'song' ? 'songs' : entityType === 'tour' ? 'tours' : 'concerts'
  const objectPath = `music-cover/${folder}/${entityId}/cover.webp`
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'image/webp', 'Cache-Control': '31536000', 'x-upsert': 'true' },
    body: new Uint8Array(output),
  })
  if (!response.ok) return NextResponse.json({ message: '封面上传失败', detail: (await response.text().catch(() => '')).slice(0, 200) }, { status: 502 })

  const url = `${supabasePublicObjectUrl(supabaseUrl, bucket, objectPath)}?v=${Date.now()}`
  if (entityType === 'album') await prisma.musicAlbum.update({ where: { id: entityId }, data: { coverUrl: url } })
  else if (entityType === 'song') await prisma.musicSong.update({ where: { id: entityId }, data: { coverUrl: url } })
  else if (entityType === 'tour') await prisma.musicTour.update({ where: { id: entityId }, data: { posterUrl: url } })
  else await prisma.musicConcert.update({ where: { id: entityId }, data: { posterUrl: url } })
  return NextResponse.json({ url, format: 'webp', widthLimit: MUSIC_COVER_MAX_WIDTH, quality: MUSIC_COVER_QUALITY })
}
