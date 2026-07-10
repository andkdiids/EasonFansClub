import { readFile, stat } from 'fs/promises'
import path from 'path'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const contentTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

type RouteContext = { params: Promise<{ fileName: string }> }

export async function GET(_request: Request, context: RouteContext) {
  const { fileName } = await context.params
  const safeName = path.basename(fileName)
  if (safeName !== fileName || !/^[a-zA-Z0-9._-]+\.(jpg|jpeg|png|webp|gif)$/.test(safeName)) {
    return NextResponse.json({ message: '图片不存在' }, { status: 404 })
  }

  try {
    const filePath = path.join(process.cwd(), 'public', 'uploads', 'site', safeName)
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) return NextResponse.json({ message: '图片不存在' }, { status: 404 })
    const bytes = await readFile(filePath)
    return new Response(bytes, {
      headers: {
        'Content-Type': contentTypes[path.extname(safeName).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ message: '图片不存在' }, { status: 404 })
  }
}
