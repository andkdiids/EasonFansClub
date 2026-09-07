import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const globals = source('app/globals.css')
const layout = source('app/layout.tsx')
const checkinPage = source('app/checkin/page.tsx')

test('viewport 单一来源：根 layout 用 Next 官方 viewport export，页面文件无第二处手工 viewport meta', () => {
  assert.match(layout, /export const viewport: Viewport = \{/)
  // 根 layout 是唯一 viewport 出口；页面层不得再手工注入 viewport meta
  for (const file of ['app/checkin/page.tsx', 'app/clinic/page.tsx']) {
    let text = ''
    try {
      text = source(file)
    } catch {
      continue
    }
    assert.doesNotMatch(text, /<meta\s+name=["']viewport["']/, `不应手工注入 viewport meta: ${file}`)
  }
})

test('根 viewport：严格按设备宽度、禁用双指缩放、动态工具栏同步重排', () => {
  assert.match(layout, /width: 'device-width'/)
  assert.match(layout, /initialScale: 1/)
  assert.match(layout, /maximumScale: 1/)
  assert.match(layout, /userScalable: false/)
  assert.match(layout, /interactiveWidget: 'resizes-content'/)
  // 保留既有 themeColor / colorScheme，不丢字段
  assert.match(layout, /themeColor: '#0f5f8f'/)
  assert.match(layout, /colorScheme: 'light dark'/)
})

test('无桌面化降级：shell 高度使用 100dvh（而非 100vh），375/390/412 各自按设备宽渲染', () => {
  // 页面外壳高度链全部走动态 viewport 单位，避免移动地址栏把底导航推出屏幕
  assert.match(globals, /body\s*\{[^}]*min-height:\s*100dvh/)
  assert.match(globals, /\.app-shell\s*\{[^}]*min-height:\s*100dvh/)
  // 不允许把整页写死 100vh（旧写法会造成首帧高度错误）
  assert.doesNotMatch(globals, /\.app-shell\s*\{[^}]*min-height:\s*100vh/)
  assert.doesNotMatch(globals, /\.app-main-area\s*\{[^}]*min-height:\s*100vh/)
})

test('底部导航：fixed 贴视口底 + safe-area + 高 z-index，非 absolute/sticky/滚动后出现', () => {
  // 命中「position:fixed」的移动端定义（早前另有桌面端 display:none 隐藏定义）
  const mobileNav = globals.match(/\.app-mobile-nav\s*\{[^}]*(?:position:\s*fixed)[^}]*\}/)?.[0] || ''
  assert.match(mobileNav, /position:\s*fixed/)
  assert.match(mobileNav, /bottom:\s*0/)
  assert.match(mobileNav, /right:\s*0/)
  assert.match(mobileNav, /left:\s*0/)
  assert.match(mobileNav, /z-index:\s*var\(--layer-mobile-nav\)/)
  assert.match(mobileNav, /env\(safe-area-inset-bottom/)
  assert.doesNotMatch(mobileNav, /position:\s*(absolute|sticky)/)
})

test('安全区变量链：--mobile-bottom-nav-total 含 env safe-area，高度预留一致', () => {
  assert.match(globals, /--mobile-safe-area-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/)
  assert.match(globals, /--mobile-bottom-nav-total:\s*calc\(var\(--mobile-bottom-nav-height\)\s*\+\s*var\(--mobile-safe-area-bottom\)\)/)
})

test('正文底部预留：移动端 footer 底部 padding 含导航总高（内容不被导航遮挡）', () => {
  const block = globals.match(/@media \(max-width:\s*767px\)\s*\{\s*\.site-footer-info\s*\{[^}]*padding-bottom:\s*calc\(var\(--mobile-bottom-nav-total\)\s*\+\s*var\(--mobile-page-bottom-gap\)\)[^}]*\}/)?.[0] || ''
  assert.ok(block.length > 0, '移动端 footer 应预留导航高度 + 间距')
})

test('无 fixed 破坏链：.app-main-area 显式 transform/filter/perspective/contain 归零', () => {
  const area = globals.match(/\.app-main-area\s*\{[^}]+\}/)?.[0] || ''
  assert.match(area, /transform:\s*none/)
  assert.match(area, /filter:\s*none/)
  assert.match(area, /perspective:\s*none/)
  assert.match(area, /contain:\s*none/)
})

test('不粗暴锁滚动：全局无 html/body overflow:hidden；仅 overflow-x:clip 防横向溢出', () => {
  // 匹配顶层 body 主规则（行首 body {，避免误中 xxx-body 类）
  const bodyRule = globals.match(/(?:^|\n)body\s*\{[^}]*\}/)?.[0] || ''
  assert.match(bodyRule, /overflow-x:\s*clip/)
  assert.doesNotMatch(bodyRule, /overflow(?:-y)?:\s*hidden/)
})

test('挂号页容器：移动端 touch-action: pan-y 双指缩放兜底（仅本页、仅移动断点）', () => {
  assert.match(checkinPage, /className="checkin-mobile-viewport-lock/)
  const lockBlock = globals.match(/@media \(max-width:\s*767px\)\s*\{\s*\.checkin-mobile-viewport-lock\s*\{[^}]*touch-action:\s*pan-y[^}]*\}\s*\}/)?.[0] || ''
  assert.ok(lockBlock.length > 0, '应存在移动端 .checkin-mobile-viewport-lock touch-action: pan-y 规则')
  // 桌面端不得禁用（无桌面端该规则）
  assert.doesNotMatch(globals, /@media \(min-width:\s*768px\)[\s\S]{0,120}\.checkin-mobile-viewport-lock/)
})

test('MobileNavigation 始终渲染 fixed 底导航节点（SSR 输出、非条件 portal）', () => {
  const nav = source('components/layout/MobileNavigation.tsx')
  assert.match(nav, /className="mobile-bottom-nav app-mobile-nav"/)
  const shell = source('components/layout/AppShell.tsx')
  assert.match(shell, /<MobileNavigation/)
  assert.match(shell, /<div\s+className="app-shell"/)
})
