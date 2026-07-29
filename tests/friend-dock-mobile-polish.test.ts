import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')
const mobileNavigation = read('components/layout/MobileNavigation.tsx')
const css = read('app/globals.css')
const appShell = read('components/layout/AppShell.tsx')

test('open FriendDock does not render its trigger or collapsed handle', () => {
  assert.match(friendDock, /\{!open && collapsed \? \(/)
  assert.match(friendDock, /\) : !open \? \(/)
  assert.match(friendDock, /\) : null\}/)
  assert.match(css, /friend-dock\[data-friend-dock-open='true'\]>\.friend-dock-actions/)
  assert.match(css, /friend-dock\[data-friend-dock-open='true'\]>\.friend-dock-toggle \{ display:none; pointer-events:none;/)
})

test('closed FriendDock restores both expanded and collapsed triggers', () => {
  assert.match(friendDock, /className="friend-dock-toggle is-handle"/)
  assert.match(friendDock, /className="friend-dock-actions"/)
  assert.match(friendDock, /ref=\{toggleRef\}/)
})

test('E center still hides the FriendDock entry', () => {
  assert.match(css, /data-eason-center-open='true'[\s\S]*\.friend-dock/)
  assert.match(mobileNavigation, /window\.dispatchEvent\(new Event\('friend-dock:close'\)\)/)
})

test('FriendDock header no longer renders the split unread summary', () => {
  assert.doesNotMatch(friendDock, /私信 \{unreadSummary\.messages\}/)
  assert.doesNotMatch(friendDock, /好友申请 \{unreadSummary\.friendRequests\}/)
  assert.doesNotMatch(friendDock, /全部 \{unreadSummary\.total\}/)
})

test('notification link uses the unified unread total', () => {
  assert.match(friendDock, /className="friend-dock-notifications-link"/)
  assert.match(friendDock, /unreadSummary\.total > 0/)
  assert.match(friendDock, /unreadSummary\.total > 99 \? '99\+' : unreadSummary\.total/)
  assert.match(appShell, /<FriendDock currentUserId=\{user\.id\} unreadSummary=\{currentUnreadSummary\}/)
})

test('notification badge disappears at zero and formats 1 through 99 and 99+', () => {
  assert.match(friendDock, /unreadSummary\.total > 0 \? \(/)
  assert.match(friendDock, /friend-dock-notification-badge/)
  assert.match(css, /\.friend-dock-notification-badge \{[^}]*background:var\(--danger\)/)
})

test('notification link has an accessible unread label and navigates correctly', () => {
  assert.match(friendDock, /href="\/notifications"/)
  assert.match(friendDock, /`通知中心，\$\{unreadSummary\.total\}条未读`/)
  assert.match(friendDock, /: '通知中心'/)
})

test('FriendDock title actions and close button are vertically centered', () => {
  assert.match(css, /\.friend-dock-header \{[^}]*align-items:center/)
  assert.match(css, /\.friend-dock-header-actions \{[^}]*min-height:40px;[^}]*align-items:center/)
  assert.match(css, /\.friend-dock-header-actions a,[^{]*\{[^}]*min-height:40px;[^}]*align-items:center;[^}]*justify-content:center/)
})

test('mobile FriendDock uses at most 72dvh and reserves nav and background space', () => {
  assert.match(css, /--friend-dock-mobile-height:min\(72dvh,max\(180px,calc\(var\(--friend-dock-viewport-height,100dvh\) - var\(--mobile-bottom-nav-total\) - 88px\)\)\)/)
  assert.match(css, /max-height:var\(--friend-dock-mobile-height\)/)
  assert.match(css, /height:var\(--friend-dock-mobile-height\)/)
})

test('mobile FriendDock tracks visualViewport changes for keyboard compression', () => {
  assert.match(friendDock, /window\.visualViewport\?\.addEventListener\('resize', update\)/)
  assert.match(friendDock, /window\.visualViewport\?\.addEventListener\('scroll', update\)/)
  assert.match(friendDock, /height: visualViewport\?\.height \|\| window\.innerHeight/)
  assert.match(friendDock, /top: visualViewport\?\.offsetTop \|\| 0/)
})

test('friend list remains internally scrollable and its last item has padding', () => {
  assert.match(css, /\.friend-dock-list \{[^}]*min-height:0;[^}]*flex:1;[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/)
  assert.match(css, /\.friend-dock-list-end \{ height:max\(18px,env\(safe-area-inset-bottom\)\)/)
})

test('FriendDock backdrop consumes pointerdown and keeps itself until pointer completion', () => {
  assert.match(friendDock, /onPointerDown=\{consumeBackdropEvent\}/)
  assert.match(friendDock, /onPointerUp=\{handleBackdropPointerUp\}/)
  assert.match(friendDock, /onClick=\{handleBackdropClick\}/)
  assert.match(friendDock, /event\.preventDefault\(\)/)
  assert.match(friendDock, /event\.stopPropagation\(\)/)
})

test('FriendDock backdrop fallback closes after the compatibility click', () => {
  assert.match(friendDock, /backdropCloseTimerRef\.current = window\.setTimeout\(closeDock, 0\)/)
  assert.match(friendDock, /window\.clearTimeout\(backdropCloseTimerRef\.current\)/)
})

test('FriendDock backdrop covers posts links buttons and BottomNav', () => {
  assert.match(css, /\.friend-dock-backdrop \{[^}]*position:fixed;[^}]*inset:0;[^}]*pointer-events:auto;[^}]*touch-action:manipulation/)
  assert.match(css, /--layer-overlay: 90/)
  assert.match(css, /--layer-mobile-nav: 70/)
})

test('FriendDock panel actions remain separate from backdrop closing', () => {
  assert.match(friendDock, /<section[\s\S]*className=\{`friend-dock-panel/)
  assert.match(friendDock, /onChat=\{\(\) => void openChat\(friend\)\}/)
  assert.match(friendDock, /href="\/notifications"/)
  assert.match(friendDock, /aria-label="关闭好友窗口"/)
})

test('E center backdrop is a full viewport body portal independent from sheet', () => {
  assert.match(mobileNavigation, /createPortal\(/)
  assert.match(mobileNavigation, /className="mobile-center-backdrop"[\s\S]*className="mobile-center-sheet"/)
  assert.match(mobileNavigation, /document\.body/)
  assert.match(css, /\.mobile-center-backdrop \{[^}]*position:fixed;[^}]*inset:0;[^}]*height:100dvh;[^}]*min-height:100svh/)
})

test('E center backdrop does not exclude the mobile nav area', () => {
  const backdropRule = css.match(/\.mobile-center-backdrop \{[^}]*\}/)?.[0] || ''
  assert.doesNotMatch(backdropRule, /bottom:calc/)
  assert.doesNotMatch(backdropRule, /mobile-bottom-nav-total/)
  assert.doesNotMatch(css, /\.mobile-center-overlay \{/)
})

test('E center sheet independently clears nav center button and visual gap', () => {
  assert.match(css, /\.mobile-center-sheet \{[^}]*position:fixed;[^}]*bottom:calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-center-action-overhang\) \+ 10px\)/)
  assert.match(css, /--mobile-center-action-overhang: 28px/)
})

test('E center layering keeps backdrop above content nav visible and sheet on top', () => {
  assert.match(css, /--layer-floating-action: 65/)
  assert.match(css, /--layer-center-backdrop: 68/)
  assert.match(css, /--layer-mobile-nav: 70/)
  assert.match(css, /--layer-center-sheet: 110/)
  assert.match(css, /\.mobile-center-backdrop \{[^}]*z-index:var\(--layer-center-backdrop\)/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*z-index:var\(--layer-center-sheet\)/)
})

test('E center outside gesture is consumed before closing without click-through', () => {
  assert.match(mobileNavigation, /onPointerDown=\{consumeBackdropEvent\}/)
  assert.match(mobileNavigation, /onPointerUp=\{closeCenterAfterPointer\}/)
  assert.match(mobileNavigation, /onClick=\{closeCenterFromBackdrop\}/)
  assert.match(mobileNavigation, /event\.preventDefault\(\)/)
  assert.match(mobileNavigation, /event\.stopPropagation\(\)/)
})

test('E center blocks the same click on other BottomNav entries', () => {
  assert.match(mobileNavigation, /onClickCapture=\{interceptNavigationWhileCenterOpen\}/)
  assert.match(mobileNavigation, /target\.closest\('\.mobile-center-button'\)/)
  assert.match(mobileNavigation, /if \(!centerOpen\) return/)
  assert.match(mobileNavigation, /closeCenter\(\)/)
})

test('E center remains closable by center button close button Escape and route changes', () => {
  assert.match(mobileNavigation, /onClick=\{centerOpen \? closeCenter : openCenter\}/)
  assert.match(mobileNavigation, /aria-label="关闭 E院中心"/)
  assert.match(mobileNavigation, /event\.key === 'Escape'/)
  assert.match(mobileNavigation, /useEffect\(\(\) => setCenterOpen\(false\), \[pathname\]\)/)
})

test('E center sheet scrolls internally while backdrop remains fixed', () => {
  assert.match(css, /\.mobile-center-sheet \{[^}]*max-height:min\(620px,calc\(100dvh/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*overflow-y:auto;[^}]*overscroll-behavior:contain/)
  assert.match(css, /\.mobile-center-backdrop \{[^}]*width:100vw;[^}]*height:100dvh/)
})

test('FriendDock and E center changes require no schema or migration coupling', () => {
  assert.doesNotMatch(friendDock, /prisma|migration/i)
  assert.doesNotMatch(mobileNavigation, /prisma|migration/i)
})
