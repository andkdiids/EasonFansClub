import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dock = readFileSync('components/FriendDock.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')

test('FriendDock 打开时锁定所有视口的背景，并恢复原始滚动位置', () => {
  assert.match(dock, /if \(!open\) return[\s\S]*?const root = document\.documentElement/u)
  assert.match(dock, /const scrollX = window\.scrollX/u)
  assert.match(dock, /const bodyLeft = body\.style\.left/u)
  assert.match(dock, /body\.style\.position = 'fixed'/u)
  assert.match(dock, /body\.style\.overflow = 'hidden'/u)
  assert.match(dock, /body\.style\.left = `-\$\{scrollX\}px`/u)
  assert.match(dock, /window\.scrollTo\(\{ top: scrollY, left: scrollX, behavior: 'auto' \}\)/u)
  assert.match(dock, /\}, \[open\]\)/u)
})
test('今天只做一件事和新生活使用可滚动、隐藏滚动条的独立内容区', () => {
  assert.match(css, /\.friend-dock-modal-root \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;[\s\S]*?overflow: hidden;[\s\S]*?overscroll-behavior: none;/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel \{[\s\S]*?overflow-y:auto;[\s\S]*?overscroll-behavior:contain;[\s\S]*?touch-action:pan-y;[\s\S]*?-webkit-overflow-scrolling:touch;[\s\S]*?scrollbar-width:none;/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel \{[\s\S]*?overflow-x:hidden;[\s\S]*?overscroll-behavior-y:contain;/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel::-webkit-scrollbar \{ display:none; width:0; height:0; \}/u)
  assert.match(css, /\.friend-dock-panel \.growth-panel \{[\s\S]*?min-height:0;[\s\S]*?flex:1 1 0;/u)
})

test('奖励规则把周奖励压成三等分一行，并让金额固定在右侧列', () => {
  const panel = readFileSync('components/GrowthPanel.tsx', 'utf8')
  assert.match(panel, /className="growth-rule-main"[\s\S]*className="growth-rule-reward"/u)
  assert.match(css, /\.growth-reward-rule-group\[data-reward-group='weekly'\] \.growth-rule-list \{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/u)
  assert.match(css, /\.growth-reward-rule-group \.growth-rule-row \{[\s\S]*?grid-template-columns: minmax\(0,1fr\) auto;/u)
  assert.match(css, /\.growth-rule-reward \{[\s\S]*?justify-self: end;[\s\S]*?text-align: right;[\s\S]*?white-space: nowrap;/u)
  assert.match(panel, /growth-core-title-note/)
})
