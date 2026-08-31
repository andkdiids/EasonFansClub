import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('活动公共页面的中性文字使用主题 token，不把浅色文字无条件带到浅色背景', () => {
  const page = read('app/activities/page.tsx')
  const list = read('components/activities/ActivitiesListClient.tsx')
  const card = read('components/activities/ActivityCard.tsx')
  const detail = read('components/activities/ActivityDetailView.tsx')
  const registration = read('components/activities/ActivityRegistrationButton.tsx')
  const lottery = read('components/activities/ActivityLotteryPanel.tsx')
  const entry = read('components/activities/ActivityLotteryEntry.tsx')

  assert.match(page, /bg-white\/85 text-\[var\(--foreground\)\]/)
  assert.match(page, /hasBanner \? '[^']*text-white\/80' : 'text-\[var\(--foreground-muted\)\]'/)
  assert.match(list, /text-\[var\(--foreground\)\]/)
  assert.match(list, /text-\[var\(--foreground-muted\)\]/)
  assert.doesNotMatch(list, /text-brand-950|text-slate-[45]00/)

  assert.match(card, /text-\[var\(--foreground\)\]/)
  assert.match(card, /text-\[var\(--foreground-muted\)\]/)
  assert.doesNotMatch(card, /text-slate-400|text-slate-500/)

  assert.match(detail, /text-\[var\(--foreground\)\]/)
  assert.match(detail, /text-\[var\(--foreground-muted\)\]/)
  assert.match(detail, /bg-\[color-mix\(in_srgb,var\(--success\)_12%,var\(--surface\)\)\]/)
  assert.doesNotMatch(detail, /text-emerald-950|text-white/)

  assert.match(registration, /text-\[var\(--foreground\)\]/)
  assert.match(registration, /text-\[var\(--foreground-muted\)\]/)
  assert.match(registration, /bg-\[color-mix\(in_srgb,var\(--success\)_12%,var\(--surface\)\)\]/)
  assert.doesNotMatch(registration, /text-emerald-950/)

  assert.match(lottery, /text-\[var\(--foreground\)\]/)
  assert.match(lottery, /text-\[var\(--foreground-muted\)\]/)
  assert.match(lottery, /bg-\[var\(--surface-subtle\)\]/)
  assert.doesNotMatch(lottery, /text-brand-950|text-slate-[567]00|text-white|bg-violet-50\/60/)

  assert.match(entry, /text-\[var\(--foreground\)\]/)
  assert.match(entry, /text-\[var\(--foreground-muted\)\]/)
  assert.doesNotMatch(entry, /text-brand-950|text-slate-[456]00/)
})

test('活动状态 badge 和操作按钮继续保留语义色及主题 token', () => {
  const card = read('components/activities/ActivityCard.tsx')
  const detail = read('components/activities/ActivityDetailView.tsx')
  const registration = read('components/activities/ActivityRegistrationButton.tsx')
  const lottery = read('components/activities/ActivityLotteryPanel.tsx')

  assert.match(card, /ONGOING: '[^']*bg-\[color-mix\(in_srgb,var\(--success\)_12%,var\(--surface\)\)\][^']*text-\[var\(--success\)\]/)
  assert.match(card, /ENDED: '[^']*bg-\[var\(--surface-subtle\)\][^']*text-\[var\(--foreground-muted\)\]/)
  assert.match(card, /CANCELLED: '[^']*bg-\[color-mix\(in_srgb,var\(--danger\)_12%,var\(--surface\)\)\][^']*text-\[var\(--danger\)\]/)
  assert.match(detail, /bg-\[color-mix\(in_srgb,var\(--success\)_12%,var\(--surface\)\)\]/)
  assert.match(registration, /text-\[var\(--primary-foreground\)\]/)
  assert.match(lottery, /bg-\[var\(--surface-subtle\)\]/)
})
