import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import {
  assignDefaultAvatarsToUnassignedUsers,
  getDefaultAvatarPool,
  saveDefaultAvatarPool,
} from '@/lib/default-avatars'
import { publicImageUrl } from '@/lib/images'
import { describeCosError, getCosUrl, missingCosConfig, uploadToCos } from '@/lib/tencent-cos'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

async function guardAdmin() {
  return requireAdmin('site_config_manage')
}

export async function GET() {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  return NextResponse.json({ avatars: await getDefaultAvatarPool() })
}

export async function POST(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response

  // 提前检查 COS 配置，缺失时返回明确原因而不是静默 502
  const missingConfig = missingCosConfig()
  if (missingConfig.length) {
    console.error('[default-avatar] COS config missing', missingConfig)
    return NextResponse.json({ message: `腾讯云 COS 配置缺失：${missingConfig.join('、')}，请联系管理员检查服务器环境变量` }, { status: 500 })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ message: '表单解析失败，请使用 multipart/form-data 上传图片' }, { status: 400 })
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ message: '请选择默认头像图片（文件为空或未收到 file 字段）' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ message: `文件格式不支持（${file.type || '未知'}），仅支持 JPG、PNG 或 WebP 图片` }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ message: '图片不能超过 8MB' }, { status: 413 })

  let output: Buffer
  try {
    output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none', limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 1000, height: 1000, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer()
  } catch (error) {
    console.error('[default-avatar] sharp conversion failed', error)
    const detail = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ message: `sharp 转换 WebP 失败：${detail}` }, { status: 422 })
  }

  const objectPath = `site/default-avatars/${randomUUID()}.webp`
  try {
    await uploadToCos({ key: objectPath, body: output, contentType: 'image/webp' })
  } catch (error) {
    console.error('[default-avatar] COS upload failed', error)
    return NextResponse.json({ message: `COS 上传失败：${describeCosError(error)}` }, { status: 502 })
  }

  const url = publicImageUrl(getCosUrl(objectPath))
  if (!url) return NextResponse.json({ message: '默认头像地址无效' }, { status: 500 })

  try {
    const avatars = await getDefaultAvatarPool(undefined, true)
    avatars.push({ id: randomUUID(), url, enabled: true, createdAt: new Date().toISOString() })
    await saveDefaultAvatarPool(avatars)
    const assignedCount = await assignDefaultAvatarsToUnassignedUsers()
    return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), assignedCount, message: '默认头像已转换为 WebP 并启用' }, { status: 201 })
  } catch (error) {
    console.error('[default-avatar] save avatar pool failed', error)
    return NextResponse.json({ message: '头像已上传到 COS，但保存头像池失败，请刷新页面确认后重试' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id || typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ message: '默认头像状态参数无效' }, { status: 400 })
  }

  const avatars = await getDefaultAvatarPool(undefined, true)
  const index = avatars.findIndex((item) => item.id === id)
  if (index < 0) return NextResponse.json({ message: '默认头像不存在' }, { status: 404 })
  avatars[index] = { ...avatars[index], enabled: body.enabled }
  await saveDefaultAvatarPool(avatars)
  const assignedCount = body.enabled ? await assignDefaultAvatarsToUnassignedUsers() : 0
  return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), assignedCount, message: body.enabled ? '默认头像已启用' : '默认头像已停用' })
}

export async function DELETE(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ message: '缺少默认头像 ID' }, { status: 400 })

  const avatars = await getDefaultAvatarPool(undefined, true)
  const index = avatars.findIndex((item) => item.id === id && !item.retired)
  if (index < 0) return NextResponse.json({ message: '默认头像不存在' }, { status: 404 })
  avatars[index] = { ...avatars[index], enabled: false, retired: true }
  await saveDefaultAvatarPool(avatars)

  // 已分配头像继续引用原文件，因此这里只移出头像池，不删除存储对象。
  return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), message: '默认头像已从分配池移除，已有用户头像保持不变' })
}
