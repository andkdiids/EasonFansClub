import assert from 'node:assert/strict'
import test from 'node:test'
import { RealtimeHub, RealtimePublisher, type RealtimeSocket } from '../lib/realtime'
import { isRealtimeEvent, type RealtimeEvent } from '../lib/realtime-protocol'

const summary = {
  notifications: 2,
  system: 1,
  replies: 1,
  likes: 0,
  feedbackReplies: 0,
  feedback: 0,
  friendRequests: 0,
  directMessages: 0,
  messages: 0,
  total: 2,
}

function createSocket() {
  const messages: string[] = []
  const socket: RealtimeSocket = {
    readyState: 1,
    send: (data) => messages.push(data),
  }
  return { socket, messages }
}

test('realtime protocol accepts compact summaries and rejects malformed events', () => {
  const event: RealtimeEvent = {
    type: 'unread-summary',
    summary,
    changed: ['notification', 'message'],
    conversationIds: ['conversation-1'],
    updatedAt: new Date().toISOString(),
  }
  assert.equal(isRealtimeEvent(event), true)
  assert.equal(isRealtimeEvent({ ...event, summary: { total: 1 } }), false)
  assert.equal(isRealtimeEvent({ ...event, changed: ['unknown'] }), false)
})

test('realtime hub fans out to 100 in-process connections', () => {
  const hub = new RealtimeHub()
  const sockets = Array.from({ length: 100 }, () => createSocket())
  sockets.forEach(({ socket }, index) => hub.add(`user-${index}`, socket))

  const sent = hub.broadcast({
    type: 'notification-changed',
    changed: ['notification'],
    updatedAt: new Date().toISOString(),
  })

  assert.equal(sent, 100)
  assert.equal(hub.getConnectionCount(), 100)
  sockets.forEach(({ messages }) => assert.equal(messages.length, 1))
})

test('publisher sends initial summary and debounces one user change burst', async () => {
  const hub = new RealtimeHub()
  const { socket, messages } = createSocket()
  hub.add('user-1', socket)
  let summaryReads = 0
  const publisher = new RealtimePublisher(hub, async () => {
    summaryReads += 1
    return summary
  })

  await publisher.sendInitial('user-1', socket)
  publisher.emit('user-1', 'notification')
  publisher.emit('user-1', 'message', { conversationId: 'conversation-1' })
  publisher.emit('user-1', 'message', { conversationId: 'conversation-1' })
  await new Promise((resolve) => setTimeout(resolve, 800))

  assert.equal(summaryReads, 2)
  assert.equal(messages.length, 2)
  const update = JSON.parse(messages[1]) as RealtimeEvent
  assert.equal(update.type, 'unread-summary')
  if (update.type !== 'unread-summary') return
  assert.deepEqual(update.changed.sort(), ['message', 'notification'])
  assert.deepEqual(update.conversationIds, ['conversation-1'])
})

test('publisher does not query summaries for users without a live connection', async () => {
  const hub = new RealtimeHub()
  let summaryReads = 0
  const publisher = new RealtimePublisher(hub, async () => {
    summaryReads += 1
    return summary
  })

  publisher.emit('offline-user', 'notification')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(summaryReads, 0)
})
