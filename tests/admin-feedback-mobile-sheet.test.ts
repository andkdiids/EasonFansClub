import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const panel = read('app/admin/feedback/AdminFeedbackPanel.tsx')
const styles = read('app/globals.css')

test('移动端点击完整反馈卡片会立即打开详情 Sheet 并显示加载状态', () => {
  assert.match(panel, /onClick=\{\(\) => openFeedbackDetail\(item\.id\)\}/)
  assert.match(panel, /setMobileDetailOpen\(true\)/)
  assert.match(panel, /data-mobile-open=\{mobileDetailOpen \? 'true' : 'false'\}/)
  assert.match(panel, /加载反馈详情中\.\.\./)
  assert.match(panel, /role="dialog"/)
})

test('详情请求按当前选中 ID 防止旧反馈覆盖新反馈', () => {
  assert.match(panel, /setDetail\(null\)/)
  assert.match(panel, /const requestId = \+\+detailRequestIdRef\.current/)
  assert.match(panel, /if \(requestId !== detailRequestIdRef\.current\) return/)
  assert.match(panel, /setDetail\(data\.feedback\)/)
})

test('详情关闭保留列表滚动位置，并支持遮罩、返回按钮、Esc 与 Android 返回键', () => {
  assert.match(panel, /savedScrollYRef = useRef<number \| null>\(null\)/)
  assert.match(panel, /body\.style\.position = 'fixed'/)
  assert.match(panel, /window\.scrollTo\(\{ top: restoreScrollY, behavior: 'auto' \}\)/)
  assert.match(panel, /window\.history\.pushState\(\{ \.\.\.historyState, ecfcAdminFeedbackSheet: true \}/)
  assert.match(panel, /window\.addEventListener\('popstate', onPopState\)/)
  assert.match(panel, /if \(event\.key === 'Escape'\) requestCloseMobileDetail\(\)/)
  assert.doesNotMatch(panel, /scrollIntoView\(/)
})

test('回复成功后详情和列表使用同一份服务端反馈，并且不会关闭 Sheet', () => {
  const successStart = panel.indexOf("const data = await requestJson(`/api/admin/feedback/${detail.id}/replies`")
  const successEnd = panel.indexOf('setReply(\'\')', successStart)
  assert.ok(successStart >= 0)
  assert.ok(successEnd > successStart)
  assert.match(panel.slice(successStart, successEnd + 20), /setDetail\(data\.feedback\)/)
  assert.match(panel.slice(successStart, successEnd + 20), /setItems\(\(current\) => current\.map\(/)
  assert.doesNotMatch(panel.slice(successStart, successEnd + 20), /setMobileDetailOpen\(false\)/)
})

test('回复与状态提交使用同一忙碌锁，避免重复提交', () => {
  assert.match(panel, /if \(!detail \|\| actionBusy\) return/)
  assert.match(panel, /setReplying\(true\)/)
  assert.match(panel, /setUpdatingStatus\(true\)/)
  assert.match(panel, /disabled=\{actionBusy\}/)
  assert.match(panel, /disabled=\{actionBusy \|\| detail\.status === value\}/)
})

test('回复失败不会清空管理员当前输入，只有成功路径才清空', () => {
  const replyStart = panel.indexOf('async function submitReply')
  const replyEnd = panel.indexOf('async function updateStatus', replyStart)
  const replySource = panel.slice(replyStart, replyEnd)
  assert.match(replySource, /catch \(err\)/)
  assert.match(replySource, /setError\(err instanceof Error \? err\.message : '回复失败'\)/)
  assert.equal((replySource.match(/setReply\(''\)/g) || []).length, 1)
  assert.ok(replySource.indexOf('setReply(\'\')') > replySource.indexOf('setDetail(data.feedback)'))
})

test('状态修改成功后详情和列表状态同步，失败保留当前详情', () => {
  const statusSource = panel.slice(panel.indexOf('async function updateStatus'), panel.indexOf('function applyFilters'))
  assert.match(statusSource, /method: 'PATCH'/)
  assert.match(statusSource, /setDetail\(data\.feedback\)/)
  assert.match(statusSource, /setItems\(\(current\) => current\.map\(/)
  assert.match(statusSource, /catch \(err\)/)
  assert.match(statusSource, /setError\(err instanceof Error \? err\.message : '状态更新失败'\)/)
})

test('反馈正文、回复和附件在 Sheet 内支持长文本与现有图片预览', () => {
  assert.match(panel, /<h3 className="text-xs font-black tracking-wide text-brand-700">反馈内容<\/h3>/)
  assert.match(panel, /whitespace-pre-wrap break-words text-sm font-bold leading-7 text-slate-700/)
  assert.match(panel, /<ImageViewer/)
  assert.match(styles, /max-height:24dvh/)
  assert.match(styles, /\.admin-feedback-detail-content \{ min-width:0; overflow-wrap:anywhere; word-break:break-word; \}/)
})

test('反馈详情正文独立滚动，回复操作区保持可见且不被长反馈推出视口', () => {
  assert.match(styles, /\.admin-feedback-detail-scroll \{ min-height:0; flex:1 1 auto; overflow-x:hidden; overflow-y:auto;/)
  assert.match(styles, /\.admin-feedback-detail-actions \{ flex:none; max-height:min\(44dvh,360px\); overflow-x:hidden; overflow-y:auto;/)
  assert.match(styles, /\.admin-feedback-detail-actions button\[type='submit'\] \{ min-height:44px; \}/)
})

test('移动端详情层高于底部导航并处理左右、底部 safe-area', () => {
  assert.match(styles, /\.admin-feedback-detail-backdrop\[data-open='true'\]\s*\{ position:fixed; z-index:calc\(var\(--layer-mobile-nav\) \+ 1\)/)
  assert.match(styles, /\.admin-feedback-detail-shell\[data-mobile-open='true'\]\s*\{ position:fixed; z-index:calc\(var\(--layer-mobile-nav\) \+ 2\)/)
  assert.match(styles, /padding:0 max\(12px,env\(safe-area-inset-right,0px\)\) 0 max\(12px,env\(safe-area-inset-left,0px\)\)/)
  assert.ok(styles.includes('padding:10px max(12px,env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) max(12px,env(safe-area-inset-left,0px))'))
})

test('桌面端继续使用原有列表加详情双栏，弹层固定规则只在移动断点启用', () => {
  assert.match(panel, /grid gap-5 md:grid-cols-\[380px_1fr\]/)
  assert.match(styles, /@media \(max-width:767px\) \{[\s\S]*admin-feedback-detail-shell\[data-mobile-open='true'\]\s*\{ position:fixed;/)
  assert.match(styles, /\.admin-feedback-detail-shell \{ min-width:0; \}/)
})

test('反馈操作不会通过整页刷新完成同步，列表项仍保留轻量按下反馈', () => {
  assert.doesNotMatch(panel, /router\.refresh\(|location\.reload\(/)
  assert.match(panel, /className=\{`admin-feedback-list-item w-full rounded-2xl/)
  assert.match(styles, /\.admin-feedback-list-item:active \{ transform:scale\(\.99\); \}/)
})
