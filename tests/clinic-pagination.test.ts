import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY,
  createAspirinClinicListScrollState,
  matchesAspirinClinicListContext,
  parseAspirinClinicListScrollState,
  readAspirinClinicListScrollStateFromHistory,
  updateAspirinClinicListHistoryState,
} from '../lib/clinic-scroll-state'
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
  assert.match(detail, /href=\{returnLinkHref\}/)
  assert.doesNotMatch(detail, /<Link href="\/clinic">← 返回候诊大厅<\/Link>/)
  // 详情服务端读取 from 并下发，且 unavailable 分支同样尊重 from。
  assert.match(detailPage, /from\?: string/)
  assert.match(detailPage, /returnHref=\{returnHref\}/)
  assert.match(detailPage, /query\.from/)
})

test('门诊滚动状态按页码、筛选、排序和入口帖子精确绑定', () => {
  const state = createAspirinClinicListScrollState({
    pathname: '/clinic',
    page: 3,
    filter: 'LIFE',
    sort: 'latest',
    search: '',
    tab: 'records',
    anchorPostId: 'record-3',
    scrollY: 1248,
    listHref: '/clinic?page=3&sort=latest&category=LIFE',
    savedAt: 1,
  })
  const context = { pathname: '/clinic', page: 3, filter: 'LIFE', sort: 'latest', search: '', tab: 'records' }
  assert.equal(matchesAspirinClinicListContext(state, context), true)
  assert.equal(matchesAspirinClinicListContext(state, { ...context, page: 2 }), false)
  assert.deepEqual(parseAspirinClinicListScrollState(state), state)
  assert.equal(ASPIRIN_CLINIC_LIST_SCROLL_STATE_KEY, 'aspirin-list-scroll-state')
})

test('门诊列表用 history.state 恢复帖子锚点，找不到时回退 scrollY', () => {
  const home = source('components/clinic/ClinicHomeClient.tsx')
  const card = source('components/clinic/ClinicRecordCard.tsx')
  assert.match(home, /saveScrollStateBeforeDetail/)
  assert.match(home, /readAspirinClinicListScrollStateFromHistory/)
  assert.match(home, /target\.scrollIntoView\(\{ behavior: 'auto', block: 'center' \}\)/)
  assert.match(home, /window\.scrollTo\(\{ top: pending\.scrollY, behavior: 'auto' \}\)/)
  assert.match(card, /data-post-id=\{record\.id\}/)
  assert.match(card, /onOpenDetail,/)
})

test('门诊分页、筛选、排序在新数据提交后统一回列表顶部', () => {
  const home = source('components/clinic/ClinicHomeClient.tsx')
  assert.match(home, /pendingScrollTopRef/)
  assert.match(home, /load\(1, category, sort, \{ scrollToTop: true \}\)/)
  assert.match(home, /load\(page, category, sort, \{ scrollToTop: true \}\)/)
  assert.match(home, /listTopRef\.current\?\.scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)/)
  assert.doesNotMatch(home, /window\.scrollTo\(\{ top: 0/)
})

test('详情返回只在列表来源使用历史返回，备用链接带恢复标记', () => {
  const detail = source('components/clinic/ClinicDetailClient.tsx')
  const detailPage = source('app/clinic/[recordId]/page.tsx')
  const historyState = updateAspirinClinicListHistoryState({}, null)
  assert.deepEqual(readAspirinClinicListScrollStateFromHistory(historyState), null)
  assert.match(detail, /router\.back\(\)/)
  assert.match(detail, /appendAspirinClinicListRestoreParam/)
  assert.match(detailPage, /appendAspirinClinicListRestoreParam/)
  assert.match(detailPage, /returnLinkHref/)
})
