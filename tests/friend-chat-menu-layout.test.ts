import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const dock = readFileSync('components/FriendDock.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')
const conversationRow = dock.slice(dock.indexOf('function ConversationRow'), dock.indexOf('function FriendRow'))

test('聊天行把时间和更多操作固定在右侧操作列', () => {
  assert.match(conversationRow, /friend-chat-row-meta/)
  assert.match(conversationRow, /conversation\.lastMessageAt\s*\?\s*<time>/)
  assert.match(conversationRow, /className="friend-chat-row-actions" data-conversation-menu/)
  assert.match(css, /\.friend-chat-row \{[^}]*display:flex;[^}]*gap:10px;/)
  assert.match(css, /\.friend-chat-row-main \{[^}]*min-width:0;[^}]*flex:1;/)
  assert.match(css, /\.friend-chat-row-meta \{[^}]*flex:none;[^}]*margin-left:8px;/)
  assert.match(css, /\.friend-chat-row-meta>time \{[^}]*white-space:nowrap;/)
  assert.match(css, /\.friend-chat-list \{ padding-right:12px; \}/)
  assert.match(conversationRow, /friend-chat-row-meta[\s\S]*formatConversationTime/)
})

test('聊天操作菜单由父级统一管理并支持切换、点击外部和 Escape 关闭', () => {
  assert.match(dock, /const \[activeConversationMenuId, setActiveConversationMenuId\] = useState<string \| null>\(null\)/)
  assert.match(dock, /actionsOpen=\{activeConversationMenuId === conversation\.id\}/)
  assert.match(dock, /onToggleActions=\{\(\) => setActiveConversationMenuId\(/)
  assert.match(dock, /current === conversation\.id \? null : conversation\.id/)
  assert.match(dock, /document\.addEventListener\('pointerdown', closeOnPointerDown\)/)
  assert.match(dock, /document\.addEventListener\('keydown', closeOnEscape\)/)
  assert.match(dock, /if \(event\.key === 'Escape'\) setActiveConversationMenuId\(null\)/)
  assert.match(dock, /if \(activeConversationMenuId\) setActiveConversationMenuId\(null\)/)
  assert.match(dock, /setActiveConversationMenuId\(null\)[\s\S]*setDeleteChatTarget\(conversation\)/)
  assert.doesNotMatch(conversationRow, /const \[actionsOpen, setActionsOpen\]/)
})
