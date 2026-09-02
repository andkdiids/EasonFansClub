import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('homepage content update is an in-page modal entry, never a forum or post link', () => {
  const page = read('app/community/page.tsx')
  const surface = read('components/HomeLayoutSurface.tsx')
  const loader = read('lib/home-announcement.ts')

  assert.match(page, /getHomeUpdate\(\)/)
  assert.match(loader, /type: 'UPDATE'/)
  assert.match(loader, /isPublished: true/)
  assert.match(loader, /orderBy: \[\{ publishAt: 'desc' \}, \{ priority: 'desc' \}, \{ createdAt: 'desc' \}\]/)
  for (const field of ['id', 'title', 'content', 'createdAt', 'isPublished', 'priority']) {
    assert.match(loader, new RegExp(`${field}: true`))
  }

  assert.match(surface, /<button[\s\S]*className="community-announcement"/)
  assert.match(surface, /onClick=\{\(\) => setIsUpdateOpen\(true\)\}/)
  assert.match(surface, /<HomeUpdateModal update=\{announcement\} onClose=/)
  assert.doesNotMatch(surface, /<Link[^>]+announcement/)
  assert.doesNotMatch(surface, /normalizeActionUrl\(announcement/)
})

test('home update modal has the required content, close action, and mobile scrolling boundary', () => {
  const modal = read('components/HomeUpdateModal.tsx')

  assert.match(modal, /role="dialog"/)
  assert.match(modal, /私家E院 · 内容更新/)
  assert.match(modal, /max-h-\[80vh\]/)
  assert.match(modal, /overflow-y-auto/)
  assert.match(modal, /<footer className="flex shrink-0[\s\S]*关闭/)
  assert.match(modal, /event\.key === 'Escape'/)
  assert.match(modal, /onClick=\{onClose\}/)
})

test('homepage updates reuse the existing UPDATE changelog administration workflow', () => {
  const adminList = read('app/api/admin/changelog/route.ts')
  const adminItem = read('app/api/admin/changelog/[id]/route.ts')
  const adminPanel = read('app/admin/changelog/AdminChangelogPanel.tsx')

  assert.match(adminList, /requireAdmin\('changelog_manage'\)/)
  assert.match(adminList, /type: 'UPDATE'/)
  assert.match(adminList, /published: publishNow/)
  assert.match(adminItem, /status === 'PUBLISHED'/)
  assert.match(adminItem, /published,?\s*isPublished/)
  assert.match(adminPanel, /\/api\/admin\/changelog/)
  assert.match(adminPanel, /status: 'PUBLISHED'/)
  assert.match(adminPanel, /status: 'UNPUBLISHED'/)
})
