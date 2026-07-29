import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const friendDock = read('components/FriendDock.tsx')
const coverRoute = read('app/api/admin/music/covers/route.ts')
const previewRoute = read('app/api/admin/music/songs/[songId]/preview/route.ts')
const previewProcessor = read('lib/music-preview.ts')
const mediaStorage = read('lib/music-media-storage.ts')
const player = read('components/music/MusicPlayer.tsx')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260730110000_add_music_song_preview/migration.sql')
const messagesRoute = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
const profileDrawer = read('app/profile/ProfileEditorDrawer.tsx')
const profileForm = read('app/profile/ProfileSettingsForm.tsx')
const headerFrame = read('components/SiteHeaderFrame.tsx')
const css = read('app/globals.css')
const nginxWorkflow = read('.github/workflows/configure-production-entry.yml')

test('FriendDock 打开时锁定根节点和 body 并保存滚动位置', () => {
  assert.match(friendDock, /const scrollY = window\.scrollY/)
  assert.match(friendDock, /root\.style\.overflow = 'hidden'/)
  assert.match(friendDock, /body\.style\.position = 'fixed'/)
  assert.match(friendDock, /body\.style\.top = `-\$\{scrollY\}px`/)
})

test('FriendDock 关闭时恢复原样式和滚动位置', () => {
  assert.match(friendDock, /root\.style\.overflow = rootOverflow/)
  assert.match(friendDock, /body\.style\.position = bodyPosition/)
  assert.match(friendDock, /window\.scrollTo\(\{ top: scrollY, left: 0, behavior: 'auto' \}\)/)
  assert.match(css, /\.friend-dock-backdrop \{[^}]*height:100dvh;[^}]*min-height:100svh/)
})

test('音乐封面限制10MB并在服务器转为 WebP 后上传 COS', () => {
  assert.match(coverRoute, /MUSIC_COVER_MAX_FILE_SIZE/)
  assert.match(coverRoute, /failure\(413, 'FILE_TOO_LARGE'/)
  assert.match(coverRoute, /convertMusicCoverToWebp/)
  assert.match(coverRoute, /uploadMusicMedia\(\{ kind: 'cover'/)
  assert.doesNotMatch(coverRoute, /SUPABASE|supabase/i)
})

test('COS 音乐对象使用公开读取地址且不暴露密钥', () => {
  assert.match(mediaStorage, /ACL: 'public-read'/)
  assert.match(mediaStorage, /TENCENT_COS_MUSIC_BUCKET/)
  assert.match(mediaStorage, /TENCENT_COS_MUSIC_PUBLIC_BASE_URL/)
  assert.match(mediaStorage, /console\.error\('\[music-media\.cos\]', \{[\s\S]*kind,[\s\S]*code:[\s\S]*statusCode:/)
})

test('音频上传严格限制100MB和支持格式', () => {
  assert.match(previewProcessor, /100 \* 1024 \* 1024/)
  for (const type of ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/aac']) {
    assert.match(previewProcessor, new RegExp(type.replace('/', '\\/')))
  }
  assert.match(previewRoute, /FILE_TOO_LARGE/)
  assert.match(previewRoute, /failure\(413, 'FILE_TOO_LARGE'/)
})

test('FFmpeg 只输出7秒128kbps MP3并在 finally 清理临时目录', () => {
  assert.match(previewProcessor, /MUSIC_PREVIEW_DURATION = 7/)
  assert.match(previewProcessor, /'-t',\s*String\(MUSIC_PREVIEW_DURATION\)/)
  assert.match(previewProcessor, /'128k'/)
  assert.match(previewProcessor, /'libmp3lame'/)
  assert.match(previewProcessor, /finally \{[\s\S]*rm\(tempDirectory, \{ recursive: true, force: true \}\)/)
})

test('试听只上传派生文件且使用稳定 COS 路径', () => {
  assert.match(previewRoute, /music-preview\/\$\{song\.albumId\}\/\$\{song\.id\}\/preview\.mp3/)
  assert.match(previewRoute, /sourceStored: false/)
  assert.doesNotMatch(previewRoute, /sourceUrl|sourceStored: true/)
})

test('MusicSong 预览字段和 migration 仅做增量新增', () => {
  assert.match(schema, /previewUrl\s+String\?/)
  assert.match(schema, /previewDuration\s+Int\s+@default\(7\)/)
  assert.match(migration, /ADD COLUMN `previewUrl`/)
  assert.match(migration, /ADD COLUMN `previewDuration`/)
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE)\b/i)
})

test('歌曲详情播放器最多播放7秒且不循环', () => {
  assert.match(player, /previewDuration = 7/)
  assert.match(player, /Math\.min\(7, previewDuration \|\| 7\)/)
  assert.match(player, /loop=\{false\}/)
  assert.match(player, /audio\.pause\(\)/)
})

test('Nginx 接收100MB音频并为转码保留超时时间', () => {
  assert.equal((nginxWorkflow.match(/client_max_body_size 110m/g) || []).length, 2)
  assert.equal((nginxWorkflow.match(/proxy_read_timeout 180s/g) || []).length, 2)
  assert.equal((nginxWorkflow.match(/proxy_send_timeout 180s/g) || []).length, 2)
})

test('私信 API 始终返回结构化成功或失败代码', () => {
  for (const code of ['UNAUTHORIZED', 'INVALID_CONTENT', 'NOT_PARTICIPANT', 'NOT_FRIEND', 'INVALID_CLIENT_MESSAGE_ID', 'DUPLICATE_MESSAGE', 'DATABASE_ERROR']) {
    assert.match(messagesRoute, new RegExp(`'${code}'`))
  }
  assert.match(messagesRoute, /\{ success: false, error, code, message: error \}/)
  assert.match(messagesRoute, /success: true/)
})

test('私信重试复用 clientMessageId 并保留失败输入', () => {
  assert.match(friendDock, /sendMessage\(\{ content: message\.content, clientMessageId: message\.clientMessageId/)
  assert.match(friendDock, /setContent\(\(current\) => current\.trim\(\) === trimmed \? '' : current\)/)
  assert.match(friendDock, /sendingMessageIdsRef\.current\.has/)
  assert.match(friendDock, /clientMessageId = createMessageId\(\)/)
  assert.match(friendDock, /finally \{/)
})

test('私信网络异常恢复发送状态且轮询不覆盖 optimistic 消息', () => {
  assert.match(friendDock, /sendError instanceof TypeError/)
  assert.match(friendDock, /status: 'FAILED'/)
  assert.match(friendDock, /setSending\(sendingMessageIdsRef\.current\.size > 0\)/)
  assert.match(friendDock, /item\.id === message\.id/)
  assert.match(friendDock, /item\.clientMessageId === message\.clientMessageId/)
})

test('私信发送统一走 form submit 并处理响应解析失败', () => {
  assert.match(friendDock, /<form className="friend-chat-composer" onSubmit=\{submitMessage\}>/)
  assert.match(friendDock, /event\.currentTarget\.form\?\.requestSubmit\(\)/)
  assert.match(friendDock, /<button type="submit" disabled=/)
  assert.match(friendDock, /response\.ok \? '服务器返回格式异常，消息未确认发送'/)
  assert.match(friendDock, /if \(!response\.ok\)/)
  assert.match(friendDock, /typeof cryptoApi\?\.randomUUID === 'function'/)
  assert.match(friendDock, /bytes\[6\] = \(bytes\[6\] & 0x0f\) \| 0x40/)
})

test('桌面 FriendDock 固定动态视口高度且只有好友列表内部滚动', () => {
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-dock-panel \{[\s\S]*height:640px;[\s\S]*max-height:calc\(100vh - 120px\);[\s\S]*transform:none;[\s\S]*animation:none/)
  assert.match(css, /\.friend-dock-panel \{[^}]*overflow:hidden;[^}]*pointer-events:auto/)
  assert.match(css, /\.friend-dock-header \{[^}]*flex:none/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-dock-list \{ height:100%; min-height:0; flex:1 1 0; overflow-y:auto; \}/)
})

test('FriendDock 发送点击层可用且输入和按钮触控区至少44px', () => {
  assert.match(css, /\.friend-dock-panel \{[^}]*z-index:var\(--layer-friend-window\);[^}]*isolation:isolate/)
  assert.match(css, /\.friend-chat-composer \{[^}]*z-index:2;[^}]*pointer-events:auto/)
  assert.match(css, /\.friend-chat-composer textarea \{[^}]*min-height:44px/)
  assert.match(css, /\.friend-chat-composer>button\[type='submit'\] \{[^}]*height:44px;[^}]*pointer-events:auto/)
})

test('FriendDock 仅在小于768px渲染遮罩并锁定页面', () => {
  assert.match(friendDock, /window\.matchMedia\('\(max-width: 767px\)'\)/)
  assert.match(friendDock, /\{isMobileDrawer \? \([\s\S]*className="friend-dock-backdrop"/)
  assert.match(friendDock, /if \(!open \|\| !isMobileDrawer\) return/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-dock-backdrop \{ display:none; pointer-events:none; \}/)
})

test('关闭 FriendDock 会统一清理聊天状态并重新打开好友列表', () => {
  assert.match(friendDock, /const resetChat = useCallback\(\(\) => \{[\s\S]*setChatFriend\(null\)[\s\S]*setConversationId\(''\)[\s\S]*setMessages\(\[\]\)/)
  assert.match(friendDock, /const closeDock = useCallback\(\(\) => \{[\s\S]*setOpen\(false\)[\s\S]*resetChat\(\)/)
  assert.match(friendDock, /const openFriendList = useCallback\(\(\) => \{[\s\S]*resetChat\(\)[\s\S]*setOpen\(true\)/)
  assert.match(friendDock, /onClick=\{open \? closeDock : openFriendList\}/)
})

test('好友列表和私信面板在桌面端保持相同固定高度', () => {
  assert.match(friendDock, /<div className="friend-dock-body">[\s\S]*className="friend-chat-layout"[\s\S]*className="friend-list-layout"/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-dock-panel\.is-list,\.friend-dock-panel\.is-chat \{[\s\S]*height:640px;[\s\S]*max-height:calc\(100vh - 120px\)/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-list-layout,\.friend-chat-layout \{ height:100%; min-height:0; flex:1 1 0; \}/)
  assert.match(css, /@media \(min-width:768px\) \{[\s\S]*\.friend-chat-messages \{ min-height:0; flex:1 1 0; overflow-y:auto; \}[\s\S]*\.friend-chat-composer \{ position:relative; bottom:auto; flex:none; \}/)
})

test('公共顶部搜索区域仅移除非首页分割线', () => {
  assert.match(css, /\.app-topbar:not\(\.app-topbar-home\) \{ border-bottom:0; box-shadow:none; \}/)
  assert.match(css, /\.app-topbar-home \{[^}]*border-color:/)
})

test('资料编辑器通过 body Portal 高于全局 Header 和底栏', () => {
  assert.match(profileDrawer, /createPortal\(/)
  assert.match(profileDrawer, /document\.body/)
  assert.match(profileDrawer, /z-\[var\(--layer-dialog\)\]/)
  assert.match(profileDrawer, /role="dialog"/)
  assert.match(profileDrawer, /aria-modal="true"/)
})

test('资料编辑器开启后隐藏全局 Header 搜索线和移动固定入口', () => {
  assert.match(profileDrawer, /root\.dataset\.profileEditorOpen = 'true'/)
  assert.match(css, /data-profile-editor-open='true'[\s\S]*\.site-header-frame[\s\S]*\.site-mobile-nav/)
  assert.match(css, /visibility:hidden;[\s\S]*pointer-events:none/)
})

test('非首页 Header 去除分隔阴影而首页样式保持独立', () => {
  assert.match(headerFrame, /const homeRoute = pathname === '\/'/)
  assert.match(headerFrame, /site-header-frame-home/)
  assert.match(css, /\.site-header-frame:not\(\.site-header-frame-home\) \{ box-shadow:none; \}/)
})

test('资料抽屉覆盖动态视口且底部操作栏不再避让已隐藏底栏', () => {
  assert.match(profileDrawer, /profile-editor-drawer[\s\S]*h-full min-h-0/)
  assert.match(profileDrawer, /profile-editor-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain/)
  assert.match(css, /\.profile-editor-overlay \{[^}]*height:calc\(100dvh - max\(0px,env\(safe-area-inset-top\)\)\);[^}]*min-height:0/)
  assert.match(css, /\.profile-editor-drawer \.profile-settings-actions \{ bottom:0; \}/)
})

test('背景上传使用显式 label 触发文件选择且只支持三种格式', () => {
  assert.match(profileForm, /htmlFor="profile-background-upload"/)
  assert.match(profileForm, /id="profile-background-upload"/)
  assert.match(profileForm, /className="sr-only"/)
  assert.match(profileForm, /accept="image\/jpeg,image\/png,image\/webp"/)
  assert.doesNotMatch(profileForm, /accept="image\/jpeg,image\/png,image\/webp,image\/gif"/)
})

test('背景上传展示处理上传阶段并捕获超时和网络错误', () => {
  assert.match(profileForm, /setBackgroundStage\('processing'\)/)
  assert.match(profileForm, /setBackgroundStage\('uploading'\)/)
  assert.match(profileForm, /backgroundStage === 'processing' \? '处理中…'/)
  assert.match(profileForm, /uploadError instanceof TypeError/)
  assert.match(profileForm, /finally \{/)
})
