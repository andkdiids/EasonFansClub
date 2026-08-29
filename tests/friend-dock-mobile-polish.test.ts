import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')
const mobileNavigation = read('components/layout/MobileNavigation.tsx')
const css = read('app/globals.css')
const appShell = read('components/layout/AppShell.tsx')

test('open mobile FriendDock hides its trigger while desktop keeps a close toggle', () => {
  assert.match(friendDock, /\{!open && collapsed \? \(/)
  assert.match(friendDock, /\) : !open \|\| !isMobileDrawer \? \(/)
  assert.match(friendDock, /onClick=\{open \? closeDock : openFriendList\}/)
  assert.match(friendDock, /\) : null\}/)
  assert.match(css, /friend-dock\[data-friend-dock-open='true'\]>\.friend-dock-actions/)
  assert.match(css, /friend-dock\[data-friend-dock-open='true'\]>\.friend-dock-toggle \{ display:none; pointer-events:none;/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*friend-dock\[data-friend-dock-open='true'\]>\.friend-dock-actions \{ display:flex; pointer-events:auto; \}/)
})

test('closed FriendDock restores both expanded and collapsed triggers', () => {
  assert.match(friendDock, /className="friend-dock-toggle is-handle"/)
  assert.match(friendDock, /className="friend-dock-actions"/)
  assert.match(friendDock, /ref=\{toggleRef\}/)
})

test('closing FriendDock invalidates pending chat work and clears all chat-only state', () => {
  assert.match(friendDock, /const chatSessionRef = useRef\(0\)/)
  assert.match(friendDock, /const resetChat = useCallback\(\(\) => \{[\s\S]*chatSessionRef\.current \+= 1[\s\S]*setChatFriend\(null\)[\s\S]*setConversationId\(''\)[\s\S]*setMessages\(\[\]\)[\s\S]*setContent\(''\)[\s\S]*setSending\(false\)[\s\S]*setLoadingOlder\(false\)/)
  assert.match(friendDock, /const closeDock = useCallback\(\(\) => \{[\s\S]*setOpen\(false\)[\s\S]*resetChat\(\)/)
  assert.match(friendDock, /if \(chatSession !== chatSessionRef\.current\) return/)
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
  assert.match(css, /\.friend-dock-header-actions \{[^}]*min-height:44px;[^}]*align-items:center/)
  assert.match(css, /\.friend-dock-header-actions a,[^{]*\{[^}]*min-height:44px;[^}]*align-items:center;[^}]*justify-content:center/)
})

test('mobile FriendDock is a contained floating drawer that keeps page context visible', () => {
  const panelRule = css.match(/\.friend-dock-panel \{[^}]*top:50%;[^}]*\}/)?.[0] || ''
  const modeRule = css.match(/\.friend-dock-panel\.is-list,\.friend-dock-panel\.is-chat \{[^}]*\}/)?.[0] || ''
  assert.match(panelRule, /top:50%;/)
  assert.match(panelRule, /right:0;/)
  assert.match(panelRule, /width:80vw;/)
  assert.match(panelRule, /max-width:420px;/)
  assert.match(panelRule, /height:min\(82(?:vh|dvh),/)
  assert.match(panelRule, /max-height:calc\(var\(--friend-dock-viewport-height,100dvh\) - 120px\)/)
  assert.match(panelRule, /contain:layout paint;/)
  assert.match(panelRule, /overflow:hidden;/)
  assert.match(panelRule, /transform:translateY\(-50%\)/)
  assert.match(modeRule, /height:min\(82(?:vh|dvh),/)
  assert.match(modeRule, /max-height:calc\(var\(--friend-dock-viewport-height,100dvh\) - 120px\)/)
  assert.match(css, /@keyframes friend-dock-drawer-in \{ from \{ transform:translate\(100%,-50%\); \} to \{ transform:translate\(0,-50%\); \} \}/)
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
  assert.match(css, /--layer-mobile-nav: 99999/)
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

test('E center layering keeps the backdrop above the bottom nav while open', () => {
  assert.match(css, /--layer-floating-action: 65/)
  assert.match(css, /--layer-center-backdrop: 68/)
  assert.match(css, /--layer-mobile-nav: 99999/)
  assert.match(css, /--layer-center-sheet: 110/)
  assert.match(css, /\.app-mobile-nav\[data-center-open='true'\] \{[^}]*z-index:calc\(var\(--layer-center-backdrop\) - 1\);[^}]*pointer-events:none/)
  assert.match(css, /:root\[data-eason-center-open='true'\] \.app-main-area \{[^}]*pointer-events:none/)
  assert.match(css, /\.mobile-center-backdrop \{[^}]*z-index:var\(--layer-center-backdrop\)/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*z-index:var\(--layer-center-sheet\)[^}]*pointer-events:auto/)
})

test('E center keeps the backdrop mounted until the compatibility click closes it', () => {
  assert.match(mobileNavigation, /onPointerDown=\{consumeBackdropEvent\}/)
  assert.match(mobileNavigation, /onClick=\{closeCenterFromBackdrop\}/)
  assert.doesNotMatch(mobileNavigation, /onPointerUp=\{closeCenterAfterPointer\}/)
  assert.doesNotMatch(mobileNavigation, /backdropCloseTimer/)
  assert.match(mobileNavigation, /event\.target !== event\.currentTarget/)
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
