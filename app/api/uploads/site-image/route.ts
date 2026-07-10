import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'

const maxFileSize = 8 * 1024 * 1024
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

export async function POST(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  }

  const extension = allowedTypes.get(file.type)
  if (!extension) {
    return NextResponse.json({ message: '仅支持 JPG、PNG、WEBP 或 GIF 图片' }, { status: 400 })
  }
  if (file.size > maxFileSize) {
    return NextResponse.json({ message: '图片不能超过 8MB' }, { status: 400 })
  }

  const fileName = `site-${randomUUID()}.${extension}`
  const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'site')
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()))

  return NextResponse.json({ url: `/uploads/site/${fileName}` })
}
