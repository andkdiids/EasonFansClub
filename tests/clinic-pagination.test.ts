import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

// 阿士匹林门诊：从帖子详情返回时，必须恢复进入前的列表状态（页码/筛选/排序）。
test('门诊列表把状态写入 URL，翻页与筛选可经浏览器返回/刷新恢复', () => {
  const home = source('components/clinic/ClinicHomeClient.tsx')
  const page = source('app/clinic/page.tsx')
  // 列表页将页码/排序/分类编码进 URL（replaceState，不新增历史记录）。
  assert.match(home, /window\.history\.replaceState/)
  assert.match(home, /buildClinicListHref/)
  assert.match(home, /syncClinicListUrl/)
  assert.match(home, /params\.set\('page', String\(page\)\)/)
  // 服务端列表页本来就按 searchParams 的 page/category/sort 读取，返回即恢复。
  assert.match(page, /params\.page/)
  assert.match(page, /listPublicClinicRecords\(/)
})

test('门诊卡片携带 returnHref（from），详情返回精准回到原列表状态', () => {
  const card = source('components/clinic/ClinicRecordCard.tsx')
  const detail = source('components/clinic/ClinicDetailClient.tsx')
  const detailPage = source('app/clinic/[recordId]/page.tsx')
  // 卡片链接把当前列表地址作为 from 传给详情。
  assert.match(card, /returnHref\?/)
  assert.match(card, /from=\${encodeURIComponent\(returnHref\)}/)
  // 详情返回按钮优先使用 from，不再硬编码回候诊大厅首页。
  assert.match(detail, /href=\{returnHref \|\| '\/clinic'\}/)
  assert.doesNotMatch(detail, /<Link href="\/clinic">← 返回候诊大厅<\/Link>/)
  // 详情服务端读取 from 并下发，且 unavailable 分支同样尊重 from。
  assert.match(detailPage, /from\?: string/)
  assert.match(detailPage, /returnHref=\{returnHref\}/)
  assert.match(detailPage, /query\.from/)
})
