import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { message: '本地头像文件已迁移到 Supabase Storage，请使用数据库中的 HTTPS 图片地址。' },
    { status: 410 },
  )
}
