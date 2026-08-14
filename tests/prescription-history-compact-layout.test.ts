import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('历史处方卡片使用紧凑且不依赖固定高度的响应式布局', () => {
  const page = read('app/prescription/history/page.tsx')
  const css = read('app/globals.css').replace(/\s+/g, ' ')

  assert.match(page, /className="mt-4 space-y-3"/)
  assert.match(css, /\.prescription-history-page \.prescription-card \{[^}]*margin:0;[^}]*border-radius:16px/)
  assert.match(css, /\.prescription-history-page \.prescription-card>header \{[^}]*align-items:center;[^}]*flex-direction:row;[^}]*padding:9px 14px/)
  assert.match(css, /\.prescription-history-page \.prescription-points \{[^}]*padding:10px 14px/)
  assert.match(css, /\.prescription-history-page \.prescription-lyric \{[^}]*padding:10px 14px/)
  assert.match(css, /\.prescription-history-page \.prescription-lyric blockquote \{[^}]*-webkit-line-clamp:3/)
  assert.match(css, /\.prescription-history-page \.prescription-card>footer \{[^}]*grid-template-columns:minmax\(0,1fr\) auto/)
  assert.match(css, /\.prescription-history-page \.prescription-save-button \{[^}]*min-height:32px/)
  assert.doesNotMatch(css, /\.prescription-history-page \.prescription-card[^}]*min-height/)
})
