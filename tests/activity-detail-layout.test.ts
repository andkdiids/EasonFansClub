import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动详情把顶部操作、报名福利和活动详情组织为唯一信息层级', () => {
  const detail = read('components/activities/ActivityDetailView.tsx')
  const registration = read('components/activities/ActivityRegistrationButton.tsx')

  assert.match(detail, /activity-detail-topbar/)
  assert.match(detail, /← 返回活动中心/)
  assert.equal((detail.match(/<ActivityShareButton/g) || []).length, 1)
  assert.equal((detail.match(/<ActivityLotteryPanel/g) || []).length, 1)
  assert.match(detail, /<ActivityLotteryPanel[^>]*embedded/)
  assert.match(detail, /报名说明 \/ 报名福利/)
  assert.match(detail, /活动详情/)
  assert.ok(detail.indexOf('activity-detail-topbar') < detail.indexOf('<ActivityLotteryPanel'))
  assert.ok(detail.indexOf('<ActivityLotteryPanel') < detail.indexOf('activity-description-'))
  assert.doesNotMatch(detail, /mt-8 flex flex-wrap items-center gap-3 border-t/)
  assert.match(registration, /报名即代表兑换本活动物料 ×1/)
  assert.doesNotMatch(registration, /mt-4 rounded-xl border border-\[var\(--border\)\] bg-\[var\(--surface\)\]/)
})

test('活动详情桌面端使用命名网格区域，移动端恢复纵向阅读顺序', () => {
  const css = read('app/globals.css')

  assert.match(css, /\.activity-detail-layout[\s\S]*grid-template-areas:/)
  assert.match(css, /"poster main aside"/)
  assert.match(css, /"poster lower aside"/)
  assert.match(css, /\.activity-detail-poster \{ grid-area: poster/)
  assert.match(css, /\.activity-detail-main \{ grid-area: main/)
  assert.match(css, /\.activity-detail-aside \{ grid-area: aside/)
  assert.match(css, /\.activity-detail-lower \{ grid-area: lower/)
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.activity-detail-layout[\s\S]*display: flex/)
  assert.match(css, /\.activity-detail-poster,[\s\S]*\.activity-detail-lower[\s\S]*width: 100%/)
})
