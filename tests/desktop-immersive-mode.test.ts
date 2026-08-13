import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('娱乐天空使用统一桌面沉浸模式，移动端不显示切换按钮', () => {
  const shell = read('components/layout/AppShell.tsx')
  const toggle = read('components/layout/DesktopImmersiveToggle.tsx')
  const css = read('app/globals.css')

  assert.match(shell, /const immersiveRoutePrefixes = \['\/games', '\/entertainment'\]/)
  assert.match(shell, /data-sidebar-collapsed=\{isEntertainmentRoute && sidebarCollapsed \? 'true' : undefined\}/)
  assert.match(shell, /<DesktopImmersiveToggle[\s\S]*visible=\{isEntertainmentRoute\}/)
  assert.match(toggle, /collapsed \? '>>' : '<<'/)
  assert.match(toggle, /aria-label=\{collapsed \? '展开左侧导航' : '收起左侧导航'\}/)
  assert.match(css, /@media \(min-width:768px\)[\s\S]*\.app-shell\[data-sidebar-collapsed='true'\] \.app-sidebar[\s\S]*transform:translateX\(-100%\)/)
  assert.match(css, /\.app-shell\[data-sidebar-collapsed='true'\] \.app-main-area \{ width:100%; margin-left:0; \}/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.desktop-immersive-toggle \{ display:none; \}/)
  assert.doesNotMatch(css, /\.app-shell\[data-sidebar-collapsed='true'\][^}]*width:100vw/)
})
