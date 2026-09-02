import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { getStudioTool } from '@/lib/studio/tools'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { parseStudioThumbnail } from '@/lib/studio/thumbnail'
import { uploadSiteImage } from '@/lib/site-media-storage'

export const dynamic = 'force-dynamic'

const MAX_DATA_BYTES = 1_200_000

async function uploadStudioThumbnail(value: string | null, userId: string, projectId: string, previousUrl: string | null) {
  if (!value) return null
  try {
    const encoded = value.slice(value.indexOf(',') + 1)
    const input = Buffer.from(encoded, 'base64')
    const output = await sharp(input, { failOn: 'error', limitInputPixels: 4_000_000 })
      .resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    const hash = createHash('sha256').update(output).digest('hex').slice(0, 24)
    if (previousUrl?.includes(`/${hash}.webp`)) return previousUrl
    return await uploadSiteImage({ key: `studio/projects/${userId}/${projectId}/${hash}.webp`, body: output, contentType: 'image/webp' })
  } catch {
    return null
  }
}

function parseData(value: unknown, toolSlug: string): Prisma.InputJsonValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (candidate.tool !== toolSlug || candidate.version !== 1) return null
  const pattern = candidate.pattern
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return null
  const patternRecord = pattern as Record<string, unknown>
  const cells = patternRecord.cells
  const palette = patternRecord.palette
  const width = Number(patternRecord.width)
  const height = Number(patternRecord.height)
  if (!Array.isArray(cells) || !Array.isArray(palette) || palette.length < 1 || palette.length > 1000 || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 200 || height > 200 || cells.length !== width * height || cells.length > 40000) return null
  if (palette.some((color) => !color || typeof color !== 'object' || typeof (color as Record<string, unknown>).code !== 'string' || typeof (color as Record<string, unknown>).hex !== 'string')) return null
  if (cells.some((cell) => !Number.isInteger(cell) || Number(cell) < -1 || Number(cell) >= palette.length)) return null
  const completed = candidate.completed
  if (completed !== undefined && (!Array.isArray(completed) || completed.some((index) => !Number.isInteger(index) || Number(index) < 0 || Number(index) >= cells.length))) return null
  let serialized: string
  try { serialized = JSON.stringify(value) } catch { return null }
  if (new TextEncoder().encode(serialized).byteLength > MAX_DATA_BYTES) return null
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function projectMetadata(data: Prisma.JsonValue) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const pattern = (data as Record<string, unknown>).pattern
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) return undefined
  const row = pattern as Record<string, unknown>
  const width = typeof row.width === 'number' ? row.width : undefined
  const height = typeof row.height === 'number' ? row.height : undefined
  const cells = Array.isArray(row.cells) ? row.cells : []
  const usedColors = new Set(cells.filter((cell): cell is number => typeof cell === 'number' && cell >= 0))
  return { width, height, totalBeads: cells.filter((cell) => typeof cell === 'number' && cell >= 0).length, colorCount: usedColors.size }
}

function projectView(project: { id: string; toolSlug: string; title: string; description: string | null; version: number; data: Prisma.JsonValue; thumbnailUrl: string | null; likeCount: number; favoriteCount: number; viewCount: number; visibility: string; reviewStatus: string; createdAt: Date; updatedAt: Date; lastOpenedAt: Date | null }, includeData = false) {
  return {
    id: project.id,
    toolSlug: project.toolSlug,
    title: project.title,
    description: project.description,
    version: project.version,
    thumbnailUrl: project.thumbnailUrl,
    likeCount: project.likeCount,
    favoriteCount: project.favoriteCount,
    viewCount: project.viewCount,
    visibility: project.visibility,
    reviewStatus: project.reviewStatus,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    lastOpenedAt: project.lastOpenedAt?.toISOString() || null,
    metadata: projectMetadata(project.data),
    ...(includeData ? { data: project.data } : {}),
  }
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const projects = await prisma.studioProject.findMany({
    where: { userId: guard.user.id },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
  return NextResponse.json({ projects: projects.map((project) => projectView(project)) }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > MAX_DATA_BYTES + 10000) return NextResponse.json({ ok: false, message: '项目数据过大' }, { status: 413 })
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NextResponse.json({ ok: false, message: '项目数据格式不正确' }, { status: 400 })
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, message: '项目数据格式不正确' }, { status: 400 })
  }
  const toolSlug = typeof body.toolSlug === 'string' ? body.toolSlug.trim() : ''
  const tool = getStudioTool(toolSlug)
  if (!tool || !tool.enabled || (tool.status !== 'AVAILABLE' && tool.status !== 'BETA')) return NextResponse.json({ ok: false, message: '创作工具暂不可用' }, { status: 400 })
  const data = parseData(body.data, toolSlug)
  if (!data) return NextResponse.json({ ok: false, message: '项目数据校验失败' }, { status: 400 })
  const title = sanitizeText(body.title, 160) || '未命名作品'
  const description = sanitizeText(body.description, 500) || null
  const thumbnailUrl = parseStudioThumbnail(body.thumbnailUrl)
  const requestedId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  const existing = requestedId ? await prisma.studioProject.findFirst({ where: { id: requestedId, userId: guard.user.id }, select: { id: true, thumbnailUrl: true } }) : null
  const project = existing
    ? await prisma.studioProject.update({ where: { id: existing.id }, data: { toolSlug, title, description, version: 1, data, ...(thumbnailUrl ? { thumbnailUrl } : {}), lastOpenedAt: new Date() } })
    : await prisma.studioProject.create({ data: { userId: guard.user.id, toolSlug, title, description, version: 1, data, ...(thumbnailUrl ? { thumbnailUrl } : {}), lastOpenedAt: new Date() } })
  const uploadedThumbnail = await uploadStudioThumbnail(thumbnailUrl, guard.user.id, project.id, existing?.thumbnailUrl || null)
  const persistedProject = uploadedThumbnail && uploadedThumbnail !== project.thumbnailUrl
    ? await prisma.studioProject.update({ where: { id: project.id }, data: { thumbnailUrl: uploadedThumbnail } })
    : project
  return NextResponse.json({ ok: true, project: projectView(persistedProject, true) }, { headers: { 'Cache-Control': 'private, no-store' } })
}
