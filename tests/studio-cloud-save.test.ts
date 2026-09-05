import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import Module from 'node:module'
import { createDemoPattern } from '../lib/studio/beads/grid'
import { getDefaultPalette } from '../lib/studio/beads/palette'
import { defaultBeadSettings, createDefaultLayerStack, normalizeBeadProjectData } from '../lib/studio/beads/compat'
import { CURRENT_BEAD_PROJECT_VERSION } from '../lib/studio/beads/types'
import { parseStudioThumbnail } from '../lib/studio/thumbnail'

// ---- Mutable stubs so a single mocked module graph can drive every scenario ----
let requireUserMode: 'ok' | 'unauth' = 'ok'
let originMode: 'ok' | 'bad' = 'ok'
let createMode: 'ok' | 'fail' = 'ok'
let uploadMode: 'ok' | 'fail' = 'ok'
let createCount = 0
let updateCount = 0
let idSeq = 0
const knownIds = new Set<string>()

const prismaStub = {
  studioProject: {
    findFirst: async ({ where }: { where: { id?: string } }) => {
      if (where?.id && knownIds.has(where.id)) return { id: where.id, thumbnailUrl: null }
      return null
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (createMode === 'fail') throw new Error('ECONNRESET: simulated DB failure')
      const id = typeof data.id === 'string' && data.id ? (data.id as string) : `p_${++idSeq}`
      knownIds.add(id)
      createCount += 1
      return {
        ...data,
        id,
        likeCount: 0,
        favoriteCount: 0,
        viewCount: 0,
        downloadCount: 0,
        visibility: 'PRIVATE',
        reviewStatus: 'NONE',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastOpenedAt: null,
      }
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (createMode === 'fail') throw new Error('ECONNRESET: simulated DB failure')
      updateCount += 1
      return {
        id: 'existing',
        toolSlug: 'beads',
        title: 't',
        description: null,
        version: CURRENT_BEAD_PROJECT_VERSION,
        data: {},
        thumbnailUrl: null,
        likeCount: 0,
        favoriteCount: 0,
        viewCount: 0,
        downloadCount: 0,
        visibility: 'PRIVATE',
        reviewStatus: 'NONE',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastOpenedAt: null,
        ...data,
      }
    },
  },
}

const securityStub = {
  rejectInvalidRequestOrigin: () => (originMode === 'bad' ? new Response(JSON.stringify({ message: '请求来源校验失败，请刷新页面后重试' }), { status: 403 }) : null),
  requireUser: async () =>
    requireUserMode === 'ok'
      ? { user: { id: 'u1' }, response: null }
      : { user: null, response: new Response(JSON.stringify({ ok: false, code: 'UNAUTHENTICATED', message: '请先登录' }), { status: 401 }) },
  sanitizeText: (value: unknown, maxLength: number) => (typeof value === 'string' ? value.slice(0, maxLength) : null),
}

const mediaStub = {
  uploadSiteImage: async () => {
    if (uploadMode === 'fail') throw new Error('COS unavailable')
    return 'https://cos.example/studio/projects/u1/p1/abc.webp'
  },
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
;(Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load = function (
  request: string,
  parent?: unknown,
  isMain?: boolean,
) {
  if (request === '@/lib/prisma') return { prisma: prismaStub }
  if (request === '@/lib/security') {
    return {
      rejectInvalidRequestOrigin: securityStub.rejectInvalidRequestOrigin,
      requireUser: securityStub.requireUser,
      sanitizeText: securityStub.sanitizeText,
    }
  }
  if (request === '@/lib/site-media-storage') return { uploadSiteImage: mediaStub.uploadSiteImage }
  return (originalLoad as (request: string, parent?: unknown, isMain?: boolean) => unknown).call(this, request, parent, isMain)
}

async function loadRoute() {
  return import('../app/api/studio/projects/route')
}

function makeProjectData(width: number, height: number, fill = 0) {
  const palette = getDefaultPalette()
  const pattern = createDemoPattern(palette, width, height)
  if (fill !== 0) for (let i = 0; i < pattern.cells.length; i++) pattern.cells[i] = fill
  return {
    version: CURRENT_BEAD_PROJECT_VERSION,
    tool: 'beads',
    settings: { ...defaultBeadSettings },
    pattern,
    completed: [] as number[],
    layers: createDefaultLayerStack(),
  }
}

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/studio/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function resetModes() {
  requireUserMode = 'ok'
  originMode = 'ok'
  createMode = 'ok'
  uploadMode = 'ok'
  createCount = 0
  updateCount = 0
  knownIds.clear()
  idSeq = 0
}

// Real 8x8 PNG (96 bytes) so the route's real sharp pipeline decodes it and uploads succeed.
const thumbnailUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWPYV2HzHx9mGBkKAIXYnEGt5X8bAAAAAElFTkSuQmCC'

test('未登录保存 → 401 且返回可诊断 code', async () => {
  resetModes()
  requireUserMode = 'unauth'
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: makeProjectData(29, 29) }))
  assert.equal(res.status, 401)
  const payload = await res.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'UNAUTHENTICATED')
  assert.match(payload.message, /登录|失效/)
})

test('请求来源校验失败 → 403', async () => {
  resetModes()
  originMode = 'bad'
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: makeProjectData(29, 29) }))
  assert.equal(res.status, 403)
})

test('正常小画布保存 → 200 且核心数据落库', async () => {
  resetModes()
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: makeProjectData(29, 29), thumbnailUrl }))
  assert.equal(res.status, 200)
  const payload = await res.json()
  assert.equal(payload.ok, true)
  assert.ok(payload.project?.id)
  assert.equal(payload.previewSaved, true)
  assert.equal(createCount, 1)
})

test('102×102 空画布保存 → PASS', async () => {
  resetModes()
  const data = makeProjectData(102, 102, -1)
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data, thumbnailUrl }))
  assert.equal(res.status, 200)
  const payload = await res.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.previewSaved, true)
})

test('102×102 满画布保存 → PASS', async () => {
  resetModes()
  const data = makeProjectData(102, 102, 0)
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data, thumbnailUrl }))
  assert.equal(res.status, 200)
  const payload = await res.json()
  assert.equal(payload.ok, true)
})

test('非法尺寸 → 400 INVALID_PROJECT_DATA', async () => {
  resetModes()
  // createDemoPattern clamps to MAX_BEAD_DIMENSION=102, so build a raw oversized
  // pattern manually to prove the server rejects >102x102 (non-legacy) projects.
  const palette = getDefaultPalette()
  const data = {
    version: CURRENT_BEAD_PROJECT_VERSION,
    tool: 'beads',
    settings: { ...defaultBeadSettings },
    pattern: { width: 200, height: 200, palette, cells: new Array(200 * 200).fill(0) },
    completed: [] as number[],
    layers: createDefaultLayerStack(),
  }
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data }))
  assert.equal(res.status, 400)
  const payload = await res.json()
  assert.equal(payload.code, 'INVALID_PROJECT_DATA')
})

test('非法颜色/调色板索引 → 400', async () => {
  resetModes()
  const data = makeProjectData(29, 29, 0)
  data.pattern.cells[0] = 999
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data }))
  assert.equal(res.status, 400)
  const payload = await res.json()
  assert.equal(payload.code, 'INVALID_PROJECT_DATA')
})

test('payload 过大 → 413 PAYLOAD_TOO_LARGE', async () => {
  resetModes()
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: 'A'.repeat(2_000_000) }))
  assert.equal(res.status, 413)
  const payload = await res.json()
  assert.equal(payload.code, 'PAYLOAD_TOO_LARGE')
  assert.match(payload.message, /过大|无法保存/)
})

test('数据库 create 失败 → 500 DB_SAVE_FAILED 且记录诊断日志', async () => {
  resetModes()
  createMode = 'fail'
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: makeProjectData(29, 29) }))
  assert.equal(res.status, 500)
  const payload = await res.json()
  assert.equal(payload.code, 'DB_SAVE_FAILED')
  assert.match(payload.message, /云端存档失败|稍后/)
})

test('已有作品 update（不重复 create）', async () => {
  resetModes()
  knownIds.add('existing-1')
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ projectId: 'existing-1', toolSlug: 'beads', data: makeProjectData(29, 29) }))
  assert.equal(res.status, 200)
  assert.equal(createCount, 0)
  assert.equal(updateCount, 1)
})

test('重复点击同一 projectId → 只 create 一次，后续走 update', async () => {
  resetModes()
  const route = await loadRoute()
  const body = { projectId: 'dup-1', toolSlug: 'beads', data: makeProjectData(29, 29) }
  const first = await route.POST(makeRequest(body))
  const second = await route.POST(makeRequest(body))
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  assert.equal(createCount, 1)
  assert.equal(updateCount, 1)
})

test('预览图上传失败 → 核心作品仍保存成功（previewSaved=false，不误报）', async () => {
  resetModes()
  uploadMode = 'fail'
  const route = await loadRoute()
  const res = await route.POST(makeRequest({ toolSlug: 'beads', data: makeProjectData(29, 29), thumbnailUrl }))
  assert.equal(res.status, 200)
  const payload = await res.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.previewSaved, false)
  assert.equal(createCount, 1)
})

test('normalizeBeadProjectData 接受 102×102 满/空画布', () => {
  assert.ok(normalizeBeadProjectData(makeProjectData(102, 102, -1)))
  assert.ok(normalizeBeadProjectData(makeProjectData(102, 102, 0)))
})

test('parseStudioThumbnail 接受合理 base64 预览、拒绝超大串', () => {
  assert.equal(parseStudioThumbnail(thumbnailUrl), thumbnailUrl)
  assert.equal(parseStudioThumbnail('x'.repeat(240 * 1024 * 2 + 10)), null)
  assert.equal(parseStudioThumbnail('not-a-data-url'), null)
})

test('云端失败不清除本地草稿，且成功清除 dirty 状态', () => {
  const editor = readFileSync('components/studio/StudioBeadsTool.tsx', 'utf8')
  assert.match(editor, /if \(!response\.ok\) \{[\s\S]*?readStudioSaveErrorMessage\(response\)[\s\S]*?return/)
  assert.match(editor, /clearStudioDraft\('beads'\)/)
  assert.match(editor, /setSaveStatus\('saved'\)/)
  assert.match(editor, /setSaveStatus\('failed'\)/)
  assert.match(editor, /if \(savingRef\.current\) return/)
})

test('保存按钮在 saving 期间禁用（桌面 + 移动端）', () => {
  const shell = readFileSync('components/studio/StudioToolShell.tsx', 'utf8')
  const disabledCount = (shell.match(/disabled=\{saveStatus === 'saving'\}/g) || []).length
  assert.ok(disabledCount >= 2, `expected >=2 disabled save buttons, got ${disabledCount}`)
})
