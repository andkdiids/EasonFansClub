import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const postRoute = read('app/api/posts/[postId]/route.ts')
const replyRoute = read('app/api/replies/[replyId]/route.ts')
const postActions = read('components/PostActions.tsx')
const deleteButton = read('components/DeleteCommentButton.tsx')
const replies = read('components/PostRepliesSection.tsx')
const detailPage = read('app/posts/[postId]/page.tsx')
const schema = read('prisma/schema.prisma')

test('帖子删除使用独立 DELETE 流程、当前权限键和并发锁', () => {
  assert.match(postRoute, /export async function DELETE\(/)
  assert.match(postRoute, /hasAdminPermission\(guard\.user, 'post_manage'\)/)
  assert.match(postRoute, /SELECT [^\n]+FOR UPDATE/)
  assert.match(postRoute, /data: \{ isDeleted: true, deletedAt: new Date\(\) \}/)
  assert.match(postRoute, /POST_DELETE_FORBIDDEN/)
  assert.match(postRoute, /\[posts\.delete\]/)
  assert.match(postRoute, /\[posts\.delete\.audit\]/)
  assert.match(postActions, /method: 'DELETE'/)
  assert.match(postActions, /确认删除帖子/)
})

test('评论删除明确使用 replyId、reply_manage，软删除整棵楼中楼并返回新数量', () => {
  assert.match(replyRoute, /export async function DELETE\(/)
  assert.match(replyRoute, /hasAdminPermission\(guard\.user, 'reply_manage'\)/)
  assert.match(replyRoute, /where: \{ id: replyId \}/)
  assert.match(replyRoute, /collectThreadIds\(threadRows, replyId\)/)
  assert.match(replyRoute, /data: \{ isDeleted: true, isPinned: false, deletedAt: new Date\(\) \}/)
  assert.match(replyRoute, /data: \{ replyCount \}/)
  assert.match(replyRoute, /replyCount: result\.replyCount/)
  assert.match(replyRoute, /REPLY_DELETE_FORBIDDEN/)
  assert.match(replyRoute, /\[post-replies\.delete\]/)
  assert.doesNotMatch(replyRoute, /isAdminUser\(/)
  assert.match(schema, /isDeleted\s+Boolean\s+@default\(false\)[\s\S]*?deletedAt\s+DateTime\?/)
  assert.match(schema, /@relation\("ReplyToReply", fields: \[parentId\], references: \[id\], onDelete: NoAction\)/)
})

test('评论删除 UI 不复用帖子对象，失败可见且成功后只移除本地线程', () => {
  assert.match(deleteButton, /export function DeleteReplyButton\(/)
  assert.match(deleteButton, /endpoint=\{`\/api\/replies\/\$\{encodeURIComponent\(replyId\)\}`\}/)
  assert.match(deleteButton, /确认删除评论/)
  assert.match(deleteButton, /删除后将无法恢复，确定继续？/)
  assert.match(deleteButton, /try \{[\s\S]*finally \{[\s\S]*setIsDeleting\(false\)/)
  assert.match(replies, /canManageReplies\?/)
  assert.match(replies, /<DeleteReplyButton replyId=\{reply\.id\}/)
  assert.match(replies, /onDeleted=\{\(result\) => removeReply\(reply\.id, result\)\}/)
  assert.match(replies, /ecfc:post-reply-count/)
  assert.match(detailPage, /hasAdminPermission\(user, 'reply_manage'\)/)
  assert.match(detailPage, /canManageReplies=\{canManageReplies\}/)
})
