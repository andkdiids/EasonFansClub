import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dock = readFileSync('components/FriendDock.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')

test('FriendDock 打开时锁定所有视口的背景，并恢复原始滚动位置', () => {
  assert.match(dock, /if \(!open\) return[\s\S]*?const root = document\.documentElement/u)
  assert.match(dock, /const scrollX = window\.scrollX/u)
  assert.match(dock, /body\.style\.position = 'fixed'/u)
  assert.match(dock, /body\.style\.overflow = 'hidden'/u)
  assert.match(dock, /window\.scrollTo\(\{ top: scrollY, left: scrollX, behavior: 'auto' \}\)/u)
  assert.match(dock, /\}, \[open\]\)/u)
})
test('今天只做一件事和新生活使用可滚动、隐藏滚动条的独立内容区', () => {
  assert.match(css, /\.friend-dock-panel \.growth-panel \{[\s\S]*?overflow-y:auto;[\s\S]*?overscroll-behavior:contain;[\s\S]*?touch-action:pan-y;[\s\S]*?-webkit-overflow-scrolling:touch;[\s\S]*?scrollbar-width:none;/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel::-webkit-scrollbar \{ display:none; width:0; height:0; \}/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel \{[\s\S]*?min-height:0;[\s\S]*?flex:1 1 0;/u)
})
