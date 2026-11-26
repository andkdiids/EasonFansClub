import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RealtimeHub, RealtimePublisher } from '../lib/realtime'

const read = (path: string) => readFileSync(path, 'utf8')

function createSocket() {
  const messages: string[] = []
  return {
    socket: { readyState: 1, send: (data: string) => messages.push(data) },
    messages,
  }
}

test('a direct message notifies both participants on the summary channel', async () => {
  const route = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  // Both the sender's other devices and the recipient must learn about the
  // message; the event carries the conversation id so clients can fetch just
  // that thread instead of reloading everything.
  assert.match(route, /emitRealtimeMany\(\[user\.id, otherUserId\], 'message', \{ conversationId \}\)/)
  const readRoute = read('app/api/direct-conversations/[conversationId]/read/route.ts')
  assert.match(readRoute, /emitRealtime\(user\.id, 'message', \{ conversationId \}\)/)
})

test('the messages endpoint exposes a server-issued incremental cursor', () => {
  const route = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  assert.match(route, /const cursor = parseCursor\(url\.searchParams\.get\('after'\)\)/)
  assert.match(route, /createdAt: \{ gt: cursor\.createdAt \}/)
  assert.match(route, /createdAt: cursor\.createdAt, id: \{ gt: cursor\.id \}/)
  assert.match(route, /cursor: ordered\.length \? formatCursor\(ordered\[ordered\.length - 1\]\) : url\.searchParams\.get\('after'\)/)
  assert.match(route, /hasMore: cursor \? hasMore : false/)
  // Cursors are produced by the server, never by a client timestamp.
  assert.match(route, /function formatCursor\(message: \{ createdAt: Date; id: string \}\)/)
})

test('conversation list keeps the latest message and unread count the app renders', () => {
  const route = read('app/api/direct-conversations/route.ts')
  assert.match(route, /DirectMessage: \{ orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\], take: 1/)
  assert.match(route, /compareFriendConversationOrder/)
  assert.match(route, /unreadCount/)
})

test('the realtime publisher still batches summary events per user', async () => {
  const hub = new RealtimeHub()
  const { socket, messages } = createSocket()
  hub.add('user-1', socket)
  const publisher = new RealtimePublisher(hub, async () => ({
    notifications: 0,
    system: 0,
    replies: 0,
    likes: 0,
    wall: 0,
    feedbackReplies: 0,
    feedback: 0,
    friendRequests: 0,
    directMessages: 2,
    messages: 2,
    review: 0,
    total: 2,
  }))
  publisher.emit('user-1', 'message', { conversationId: 'conversation-1' })
  await new Promise((resolve) => setTimeout(resolve, 900))
  assert.ok(messages.length >= 1)
  const event = JSON.parse(messages[messages.length - 1]) as { type: string; changed: string[]; conversationIds: string[]; summary: { directMessages: number } }
  assert.equal(event.type, 'unread-summary')
  assert.deepEqual(event.changed, ['message'])
  assert.deepEqual(event.conversationIds, ['conversation-1'])
  assert.equal(event.summary.directMessages, 2)
})
