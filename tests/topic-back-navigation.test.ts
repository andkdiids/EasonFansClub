import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('话题详情页首屏提供统一返回按钮并安全回退到广场', () => {
  const page = readFileSync('app/topics/[topicId]/page.tsx', 'utf8')

  assert.match(page, /import \{ BackButton \} from '@\/components\/BackButton'/u)
  assert.match(page, /<BackButton fallbackHref="\/forum" \/>/u)
  assert.ok(page.indexOf('<BackButton fallbackHref="/forum" />') < page.indexOf('<header'))
})

test('统一返回按钮优先历史返回，无历史记录时使用业务 fallback', () => {
  const button = readFileSync('components/BackButton.tsx', 'utf8')

  assert.match(button, /window\.history\.length > 1/u)
  assert.match(button, /router\.back\(\)/u)
  assert.match(button, /router\.push\(fallbackHref\)/u)
})
