import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
const replyForm = read('components/ReplyForm.tsx')
const replySection = read('components/PostRepliesSection.tsx')
const postPage = read('app/posts/[postId]/page.tsx')
const commentBoundary = read('components/CommentSectionBoundary.tsx')
const css = read('app/globals.css')
const friendDock = read('components/FriendDock.tsx')
const mobileNavigation = read('components/layout/MobileNavigation.tsx')
const appShell = read('components/layout/AppShell.tsx')
const forum = read('components/ForumHome.tsx')

test('回复 API 返回前端可直接渲染且可序列化的 author 结构', () => {
  assert.match(replyRoute, /success:\s*true/)
  assert.match(replyRoute, /createdAt:\s*serializedReply\.createdAt\.toISOString\(\)/)
  assert.match(replyRoute, /updatedAt:\s*serializedReply\.updatedAt\.toISOString\(\)/)
  assert.match(replyRoute, /author:\s*\{[\s\S]*profile:\s*replyAuthor\.Profile/)
})

test('通知副作用在回复事务提交后执行且失败不改变回复成功', () => {
  const transactionEnd = replyRoute.indexOf("if ('duplicateReplyId' in reply)")
  const notificationCreate = replyRoute.indexOf('prisma.notification.create')
  assert.ok(transactionEnd > 0 && notificationCreate > transactionEnd)
  assert.match(replyRoute, /catch \(error\) \{[\s\S]*\[post:reply:notification-failed\]/)
})

test('服务端使用用户行锁和时间窗阻止快速重复回复', () => {
  assert.match(replyRoute, /FOR UPDATE/)
  assert.match(replyRoute, /duplicateReply[\s\S]*createdAt:\s*\{ gte: new Date\(Date\.now\(\) - 8_000\) \}/)
  assert.match(replyRoute, /相同回复正在处理中，请勿重复提交/)
})

test('不存在或已删除父评论返回受控冲突而非 500', () => {
  assert.match(replyRoute, /不能回复不存在或已删除的评论[\s\S]*status:\s*409/)
})

test('回复表单用同步 ref 和 disabled 状态双重防重复提交', () => {
  assert.match(replyForm, /const submittingRef = useRef\(false\)/)
  assert.match(replyForm, /if \(submittingRef\.current\) return/)
  assert.match(replyForm, /disabled=\{isSubmitting/)
})

test('回复失败保留输入且刷新异常只显示评论区错误', () => {
  const clearIndex = replyForm.indexOf("setContent('')")
  const successCheck = replyForm.indexOf('if (!data.success')
  assert.ok(clearIndex > successCheck)
  assert.match(replyForm, /router\.refresh\(\)[\s\S]*评论刷新失败/)
})

test('新回复按 id 去重并对缺失 author 使用已注销用户兜底', () => {
  assert.match(replySection, /const unavailableAuthor/)
  assert.match(replySection, /已注销用户/)
  assert.match(replySection, /current\.some\(\(item\) => item\.id === created\.id\)/)
})

test('缺失父评论和循环父子关系不会破坏评论树', () => {
  assert.match(replySection, /ids\.has\(reply\.parentId\)/)
  assert.match(replySection, /const visited = new Set<string>\(\)/)
})

test('评论查询与帖子正文查询隔离', () => {
  assert.match(postPage, /function loadPostReplies/)
  assert.match(postPage, /try \{[\s\S]*postReplies = await loadPostReplies/)
  assert.match(postPage, /\[post:comments:load-failed\]/)
})

test('评论渲染异常由局部 Error Boundary 接管', () => {
  assert.match(postPage, /<CommentSectionBoundary>/)
  assert.match(commentBoundary, /getDerivedStateFromError/)
  assert.match(commentBoundary, /评论暂时无法显示/)
})

test('统一定义真实移动底栏高度和 safe area 总高度', () => {
  assert.match(css, /--mobile-bottom-nav-height:\s*62px/)
  assert.match(css, /--mobile-safe-area-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/)
  assert.match(css, /--mobile-bottom-nav-total:\s*calc\(var\(--mobile-bottom-nav-height\) \+ var\(--mobile-safe-area-bottom\)\)/)
})

test('AppShell 只由 Footer 提供一次移动底部补偿', () => {
  assert.match(css, /\.site-footer-info \{ padding-bottom: calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\); \}/)
  assert.match(css, /\.app-shell \.site-page-main \{ padding-bottom:0; \}/)
  assert.match(css, /\.app-page-content \{ padding-bottom:0; \}/)
})

test('普通无壳页面避开固定导航且使用统一变量', () => {
  assert.match(css, /\.site-page-main \{ padding-bottom:calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\); \}/)
  assert.match(css, /\.site-mobile-nav \{ z-index:var\(--layer-mobile-nav\); height:var\(--mobile-bottom-nav-total\)/)
})

test('页面容器和社区内容不再重复叠加固定 86 或 88 像素补偿', () => {
  assert.doesNotMatch(css, /\.page-container \{ padding-block: 22px calc\(88px/)
  assert.doesNotMatch(css, /\.community-content \{ padding: [^}]*calc\(86px/)
})

test('E院广场分页采用独立间距和足够触控高度', () => {
  assert.match(forum, /className="forum-pagination flex flex-wrap/)
  assert.match(css, /\.forum-pagination \{ margin:24px 0 36px;/)
  assert.match(css, /\.forum-pagination>\* \{ min-height:40px; \}/)
})

test('320px 分页隐藏首末页且不依赖横向滚动', () => {
  assert.match(forum, /edge \/>/)
  assert.match(css, /@media \(max-width:359px\)[\s\S]*\.forum-pagination-edge \{ display:none!important; \}/)
  assert.doesNotMatch(css, /\.forum-pagination[^}]*overflow-x:\s*auto/)
})

test('当前页圆形按钮不应用 disabled 透明度', () => {
  assert.match(forum, /if \(page === currentPage\) return <span aria-current="page" className=\{className\}>/)
})

test('好友入口贴右侧并位于导航总高上方', () => {
  assert.match(css, /\.friend-dock \{ right:0; bottom:calc\(var\(--mobile-bottom-nav-total\) \+ 72px\)/)
})

test('好友入口收起状态按用户隔离存入 localStorage', () => {
  assert.match(friendDock, /friend-dock:collapsed:\$\{currentUserId\}/)
  assert.match(friendDock, /aria-label="展开好友入口"/)
})

test('好友入口复用 AppShell 的统一未读统计并显示 99+', () => {
  assert.match(appShell, /<FriendDock currentUserId=\{user\.id\} unreadCount=\{currentUnreadCount\}/)
  assert.match(friendDock, /unreadCount > 99 \? '99\+' : unreadCount/)
  assert.doesNotMatch(friendDock, /fetch\('\/api\/direct-conversations'.*unreadCount/)
})

test('统一未读计数覆盖通知、反馈、好友申请和私信', () => {
  const notifications = read('lib/notifications.ts')
  assert.match(notifications, /getUnreadNotificationCount[\s\S]*getUnreadSummary\(userId\)\)\.total/)
  for (const field of ['general', 'feedback', 'friendRequests', 'directMessages']) assert.match(notifications, new RegExp(field))
})

test('好友窗 outside-click 只注册 pointerdown 并排除窗口和入口', () => {
  assert.match(friendDock, /document\.addEventListener\('pointerdown', onPointerDown\)/)
  assert.match(friendDock, /panelRef\.current\?\.contains\(target\) \|\| toggleRef\.current\?\.contains\(target\)/)
  assert.doesNotMatch(friendDock, /addEventListener\('(touchstart|mousedown)'/)
})

test('好友窗支持遮罩、关闭按钮、Esc、再次点击入口和路由关闭', () => {
  assert.match(friendDock, /friend-dock-backdrop[\s\S]*onPointerDown=\{closeDock\}/)
  assert.match(friendDock, /aria-label="关闭好友窗口"/)
  assert.match(friendDock, /event\.key !== 'Escape'/)
  assert.match(friendDock, /setOpen\(\(value\) => !value\)/)
  assert.match(friendDock, /\[pathname, currentUserId\]/)
})

test('好友窗内部列表项可操作且不会被 outside-click 关闭', () => {
  assert.match(friendDock, /ref=\{panelRef\}/)
  assert.match(friendDock, /onClick=\{\(\) => void openChat\(friend\)\}/)
})

test('好友窗口高度基于 100dvh 且止于 BottomNav 上方', () => {
  assert.match(css, /\.friend-dock-panel \{ position:fixed;[^}]*bottom:calc\(var\(--mobile-bottom-nav-total\) \+ 8px\)[^}]*max-height:calc\(100dvh - var\(--mobile-bottom-nav-total\) - 24px\)/)
})

test('E院中心作为完整卡片止于底部导航上方', () => {
  assert.match(css, /\.mobile-center-overlay \{[^}]*inset:0 0 var\(--mobile-bottom-nav-total\)/)
  assert.match(css, /\.mobile-center-sheet \{[^}]*max-height:min\(620px,calc\(100dvh - var\(--mobile-bottom-nav-total\) - 32px\)\)[^}]*border-radius:18px/)
})

test('E院中心支持再次点击和 Esc 关闭并锁定后恢复背景滚动', () => {
  assert.match(mobileNavigation, /onClick=\{centerOpen \? closeCenter : openCenter\}/)
  assert.match(mobileNavigation, /event\.key === 'Escape'/)
  assert.match(mobileNavigation, /body\.style\.position = 'fixed'/)
  assert.match(mobileNavigation, /window\.scrollTo\(\{ top: scrollY, behavior: 'auto' \}\)/)
})

test('E院中心打开时隐藏好友、返回顶部和布局工具', () => {
  assert.match(mobileNavigation, /root\.dataset\.easonCenterOpen = 'true'/)
  assert.match(css, /data-eason-center-open='true'[\s\S]*\.friend-dock[\s\S]*\.back-to-top-button[\s\S]*\.app-layout-tools/)
})

test('E院中心保留三列且演唱会入口继续可用', () => {
  assert.match(css, /\.mobile-center-sheet>nav \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(mobileNavigation, /\{ href: '\/activities', label: '演唱会'/)
})

test('资料保存区和后台保存区避开移动导航', () => {
  assert.match(read('app/profile/ProfileSettingsForm.tsx'), /profile-settings-actions/)
  assert.match(read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx'), /admin-save-bar/)
  assert.match(css, /\.profile-settings-actions \{ bottom:calc\(var\(--mobile-bottom-nav-total\) \+ 8px\)/)
  assert.match(css, /\.admin-save-bar \{ bottom:calc\(var\(--mobile-bottom-nav-total\) \+ 8px\)/)
})

test('后台 EasMusic 页面限制主体横向溢出并保留底部安全空间', () => {
  for (const path of [
    'app/admin/music/page.tsx',
    'app/admin/music/tours/AdminTourManager.tsx',
    'app/admin/music/concerts/AdminConcertManager.tsx',
    'app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx',
  ]) assert.match(read(path), /admin-mobile-page/)
  assert.match(css, /\.admin-mobile-page \{ min-width:0; max-width:100vw; overflow-x:clip; padding-bottom:calc\(var\(--mobile-bottom-nav-total\) \+ var\(--mobile-page-bottom-gap\)\)/)
})

test('集中层级保证导航、窗口、中心、对话框、图片与 Toast 顺序', () => {
  const names = ['--layer-mobile-nav', '--layer-friend-window', '--layer-center-sheet', '--layer-dialog', '--layer-image-viewer', '--layer-toast']
  for (const name of names) assert.match(css, new RegExp(`${name}:\\s*\\d+`))
  assert.match(css, /\.notification-toast \{ z-index:var\(--layer-toast\)/)
  assert.match(read('components/ImageViewer.tsx'), /z-\[var\(--layer-image-viewer\)\]/)
})

test('EasMusic 对话框沿用集中层级且公开现场路由未被改写', () => {
  assert.match(read('components/music/MusicSearchDialog.tsx'), /z-\[var\(--layer-dialog\)\]/)
  assert.match(read('components/music/live/AttendancePanel.tsx'), /z-\[var\(--layer-dialog\)\]/)
  assert.match(read('components/layout/navigation.ts'), /href: '\/music'[\s\S]*mobile: true/)
})
